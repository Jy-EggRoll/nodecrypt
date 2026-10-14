import { generateClientId, encryptMessage, decryptMessage, logEvent, isString, isObject, isArray, getTime, setLogLevel } from './utils.js';

// 空房间的已批准设备记忆保留时长：超过它才允许被下一次加入请求顺手回收。
// 之所以要留一段时间，是因为两台自有设备同时断线重连时都需要凭 deviceId 免审批回来，
// 一空就删会让它们互相等对方批准而双双卡住。
const APPROVED_VACANT_TTL = 10 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 处理WebSocket请求
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader === 'websocket') {
      const id = env.CHAT_ROOM.idFromName('chat-room');
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    // 处理API请求
    if (url.pathname.startsWith('/api/')) {
      // ...API 逻辑...
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    // 其余全部交给 ASSETS 处理（自动支持 hash 文件名和 SPA fallback）
    return env.ASSETS.fetch(request);
  }
};

export class ChatRoom {  constructor(state, env) {
    // 签名由 Durable Objects 运行环境固定为 (state, env)；本类已不读写 state.storage（零留存），
    // 故不再保存 state，env 亦未使用，保留签名只为与平台约定一致。
    
    // Use objects like original server.js instead of Maps
    this.clients = {};
    this.channels = {};
    // 候客池：{ 房间哈希: [clientId, ...] }。等待批准的客户端只登记在这里，
    // 不写入 clients[].channel，这样 broadcastMemberList 天然不会把它算作房间成员。
    this.pending = {};

    // 已批准设备记忆：{ 房间哈希: Set<deviceId> }，用于断线重连或刷新后免二次审批。
    // 房间变空时不立刻清除其中的条目，只记下变空时刻（见 approvedEmptySince），
    // 等房间闲置超过 APPROVED_VACANT_TTL 后由下一次加入请求顺手回收。
    // 原因：两台自有设备同时断线重连时都要凭 deviceId 免审批回来，
    // 一空就删会让它们互相等对方批准而双双卡住。
    // 刻意不用 setTimeout 或 DO alarm：alarm 需要写 state.storage，会破坏中转端零留存。
    this.approved = {};
    // 已批准设备记忆的空置时刻：{ 房间哈希: 时间戳 }，与 approved 同步增删。
    this.approvedEmptySince = {};
    
    this.config = {
      seenTimeout: 60000,
      debug: false
    };

    // 日志级别由 config.debug 决定：默认只输出 warn 及以上；
    // 需要排查问题时把它置为 true，即可看到 debug 级日志。
    if (this.config.debug) {
      setLogLevel('debug');
    }
    
    // Initialize RSA key pair
    this.initRSAKeyPair();
  }

  // 密钥对只保存在 Durable Object 内存中，不落盘：中转端零留存。
  // 代价是 DO 重启后密钥会重新生成，但客户端每次连接都会重新获取公钥，功能不受影响。
  async initRSAKeyPair() {
    try {
      if (!this.keyPair) {
        console.log('Generating new RSA keypair...');
        const keyPair = await crypto.subtle.generateKey(
          {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256'
          },
          true,
          ['sign', 'verify']
        );

        // 并行导出公钥和私钥以提高性能
        const [publicKeyBuffer, privateKeyBuffer] = await Promise.all([
          crypto.subtle.exportKey('spki', keyPair.publicKey),
          crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
        ]);

        this.keyPair = {
          rsaPublic: btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer))),
          rsaPrivate: await crypto.subtle.importKey(
            'pkcs8',
            new Uint8Array(privateKeyBuffer),
            {
              name: 'RSASSA-PKCS1-v1_5',
              hash: 'SHA-256'
            },
            false,
            ['sign']
          ),
          createdAt: Date.now() // 记录密钥创建时间，用于后续判断是否需要轮换
        };

        console.log('RSA key pair generated in memory');
      }

      // 检查密钥是否需要轮换（如果已创建超过24小时且当前没有客户端）
      if (
        this.keyPair.createdAt &&
        (Date.now() - this.keyPair.createdAt > 24 * 60 * 60 * 1000) &&
        Object.keys(this.clients).length === 0
      ) {
        console.log('密钥已使用24小时且无客户端，进行轮换...');
        this.keyPair = null;
        return await this.initRSAKeyPair();
      }
    } catch (error) {
      console.error('Error initializing RSA key pair:', error);
      throw error;
    }
  }

  async fetch(request) {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket Upgrade', { status: 426 });
    }

    // Ensure RSA keys are initialized
    if (!this.keyPair) {
      await this.initRSAKeyPair();
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept the WebSocket connection
    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }  // WebSocket connection event handler
  async handleSession(connection) {    connection.accept();

    // 清理旧连接
    await this.cleanupOldConnections();

    const clientId = generateClientId();

    if (!clientId || this.clients[clientId]) {
      this.closeConnection(connection);
      return;
    }

    logEvent('connection', clientId, 'debug');    // Store client information
    this.clients[clientId] = {
      connection: connection,
      seen: getTime(),
      key: null,
      shared: null,
      channel: null,
      // 客户端持久化的设备 id，用于跨连接识别同一台设备；缺失或无效时为 null
      deviceId: null,
      // 候客状态：pendingRoom 有值期间该客户端尚未加入房间，只是申请者
      pendingRoom: null,
      pendingName: null
    };

    // Send RSA public key
    try {
      logEvent('sending-public-key', clientId, 'debug');
      this.sendMessage(connection, JSON.stringify({
        type: 'server-key',
        key: this.keyPair.rsaPublic
      }));
    } catch (error) {
      logEvent('sending-public-key', error, 'error');
    }    // Handle messages
    connection.addEventListener('message', async (event) => {
      const message = event.data;

      if (!isString(message) || !this.clients[clientId]) {
        return;
      }

      this.clients[clientId].seen = getTime();

      if (message === 'ping') {
        this.sendMessage(connection, 'pong');
        return;
      }

      logEvent('message', [clientId, message.length], 'debug');      // Handle key exchange
      if (!this.clients[clientId].shared && message.length < 2048) {
        try {
          // Generate ECDH key pair using P-384 curve (equivalent to secp384r1)
          const keys = await crypto.subtle.generateKey(
            {
              name: 'ECDH',
              namedCurve: 'P-384'
            },
            true,
            ['deriveBits', 'deriveKey']
          );

          const publicKeyBuffer = await crypto.subtle.exportKey('raw', keys.publicKey);
          
          // Sign the public key using PKCS1 padding (compatible with original)
          const signature = await crypto.subtle.sign(
            {
              name: 'RSASSA-PKCS1-v1_5'
            },
            this.keyPair.rsaPrivate,
            publicKeyBuffer
          );

          // Convert hex string to Uint8Array for client public key
          const clientPublicKeyHex = message;
          const clientPublicKeyBytes = new Uint8Array(clientPublicKeyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          
          // Import client's public key
          const clientPublicKey = await crypto.subtle.importKey(
            'raw',
            clientPublicKeyBytes,
            { name: 'ECDH', namedCurve: 'P-384' },
            false,
            []
          );

          // Derive shared secret bits (equivalent to computeSecret in Node.js)
          const sharedSecretBits = await crypto.subtle.deriveBits(
            {
              name: 'ECDH',
              public: clientPublicKey
            },
            keys.privateKey,
            384 // P-384 produces 48 bytes (384 bits)
          );          // Take bytes 8-40 (32 bytes) for AES-256 key
          this.clients[clientId].shared = new Uint8Array(sharedSecretBits).slice(8, 40);

          const response = Array.from(new Uint8Array(publicKeyBuffer))
            .map(b => b.toString(16).padStart(2, '0')).join('') + 
            '|' + btoa(String.fromCharCode(...new Uint8Array(signature)));
          
          this.sendMessage(connection, response);

        } catch (error) {
          logEvent('message-key', [clientId, error], 'error');
          this.closeConnection(connection);
        }

        return;
      }

      // Handle encrypted messages
      if (this.clients[clientId].shared && message.length <= (8 * 1024 * 1024)) {
        this.processEncryptedMessage(clientId, message);
      }
    });    // Handle connection close
    connection.addEventListener('close', async (event) => {
      logEvent('close', [clientId, event], 'debug');

      const client = this.clients[clientId];
      const channel = client ? client.channel : null;

      // 等待审批中的客户端 channel 为空，同样必须从候客池摘除，否则会留下幽灵等待者
      this.removeClientFromPending(clientId);

      if (channel && this.channels[channel]) {
        const index = this.channels[channel].indexOf(clientId);
        const removed = index !== -1;

        // 必须先判下标：indexOf 返回 -1 时 splice(-1, 1) 会误删数组最后一个成员
        if (removed) {
          this.channels[channel].splice(index, 1);
        }

        if (this.channels[channel].length === 0) {
          delete(this.channels[channel]);
          this.markApprovedVacancy(channel);
        } else if (removed) {
          // Only broadcast after a real removal. Reuse the shared implementation so
          // the me field and the exclusion rule can never drift apart from it.
          // 只有确实移除了成员才广播名单；复用同一份实现，me 字段与排除规则不会两处走样。
          this.broadcastMemberList(channel);
        }
      }

      if (this.clients[clientId]) {
        delete(this.clients[clientId]);
      }
    });
  }
  // Process encrypted messages
  processEncryptedMessage(clientId, message) {
    let decrypted = null;

    try {
      decrypted = decryptMessage(message, this.clients[clientId].shared);

      if (!isObject(decrypted) || !isString(decrypted.a)) {
        return;
      }

      const action = decrypted.a;

      // 老客户端发的 j 也并到申请路径上：服务端无法分辨「尚未升级的客户端」与
      // 「故意绕过审批的人」，只要还留一条直接放行的分支，审批就等于不存在。
      if (action === 'jr' || action === 'j') {
        this.handleJoinRequest(clientId, decrypted);
      } else if (action === 'ja') {
        this.handleApproveJoin(clientId, decrypted);
      } else if (action === 'jn') {
        this.handleDenyJoin(clientId, decrypted);
      } else if (action === 'c') {
        this.handleClientMessage(clientId, decrypted);
      } else if (action === 'w') {
        this.handleChannelMessage(clientId, decrypted);
      }

    } catch (error) {
      logEvent('process-encrypted-message', [clientId, error], 'error');
    } finally {
      decrypted = null;
    }
  }
  // 新设备候客：申请加入房间，由房间内已有设备批准后才真正加入
  handleJoinRequest(clientId, decrypted) {
    // 加入请求是唯一稳定会发生的房间活动，把惰性回收挂在这里，
    // 就不需要常驻定时器，也不必碰 state.storage
    this.sweepApprovedVacancy();

    if (!isString(decrypted.p) || this.clients[clientId].channel) {
      return;
    }

    try {
      const channel = decrypted.p;
      const name = isString(decrypted.n) ? decrypted.n : '';
      // Only a real string may become a deviceId: storing null for every client that
      // sends nothing would put them all in the approved set and let them impersonate
      // each other on the next reconnect.
      // 只有真正的字符串才作为 deviceId；把缺失值也记进 approved 会让所有未带 id
      // 的客户端在下次重连时互相冒充。
      const deviceId = isString(decrypted.d) ? decrypted.d : null;
      this.clients[clientId].deviceId = deviceId;

      const approvedDevices = this.approved[channel];
      const isKnownDevice = deviceId !== null && approvedDevices instanceof Set && approvedDevices.has(deviceId);
      const isRoomEmpty = !this.channels[channel] || this.channels[channel].length === 0;

      // 房间不存在或已无成员时，申请者即房间建立者，无需审批直接放行；
      // 已获批准过的设备重连也直接放行，避免刷新页面后退回等待状态。
      if (isKnownDevice || isRoomEmpty) {
        if (isRoomEmpty) {
          this.channels[channel] = [clientId];
        } else if (this.channels[channel].indexOf(clientId) === -1) {
          this.channels[channel].push(clientId);
        }

        this.clients[clientId].channel = channel;
        this.clearApprovedVacancy(channel);
        this.rememberApprovedDevice(channel, deviceId);
        this.sendEncrypted(clientId, { a: 'jok' });
        this.broadcastMemberList(channel);
        return;
      }

      // 同一客户端可能先申请过别的房间，先撤销旧申请，避免出现在多个候客池
      this.removeClientFromPending(clientId);

      this.clients[clientId].pendingRoom = channel;
      this.clients[clientId].pendingName = name;

      if (!this.pending[channel]) {
        this.pending[channel] = [];
      }

      if (this.pending[channel].indexOf(clientId) === -1) {
        this.pending[channel].push(clientId);
      }

      this.sendEncrypted(clientId, { a: 'jw' });

      // 逐个询问房间内已加入的成员，由其中任意一人决定批准或拒绝
      for (const member of this.channels[channel]) {
        if (this.isClientInChannel(this.clients[member], channel)) {
          this.sendEncrypted(member, { a: 'jq', c: clientId, n: name });
        }
      }
    } catch (error) {
      logEvent('message-join-request', [clientId, error], 'error');
    }
  }
  // 房间内成员批准某个候客申请者
  handleApproveJoin(clientId, decrypted) {
    if (!isString(decrypted.c) || !this.clients[clientId].channel) {
      return;
    }

    try {
      const channel = this.clients[clientId].channel;
      const targetId = decrypted.c;
      const target = this.clients[targetId];

      // 目标必须真实存在，且正好在审批者所在房间候客，否则视为无效审批
      if (!target || target.pendingRoom !== channel) {
        return;
      }

      this.removeClientFromPending(targetId);

      target.channel = channel;
      this.rememberApprovedDevice(channel, target.deviceId);
      this.clearApprovedVacancy(channel);

      if (!this.channels[channel]) {
        this.channels[channel] = [];
      }

      if (this.channels[channel].indexOf(targetId) === -1) {
        this.channels[channel].push(targetId);
      }

      this.sendEncrypted(targetId, { a: 'jok' });
      this.broadcastMemberList(channel);
    } catch (error) {
      logEvent('message-join-approve', [clientId, error], 'error');
    }
  }
  // 房间内成员拒绝某个候客申请者
  handleDenyJoin(clientId, decrypted) {
    if (!isString(decrypted.c) || !this.clients[clientId].channel) {
      return;
    }

    try {
      const channel = this.clients[clientId].channel;
      const targetId = decrypted.c;
      const waiting = this.pending[channel];

      if (!isArray(waiting) || waiting.indexOf(targetId) === -1) {
        return;
      }

      this.removeClientFromPending(targetId);
      this.sendEncrypted(targetId, { a: 'jno' });

      // 拒绝后这条连接已无任何用途，留着只会让客户端看不到结果也无法重试
      const denied = this.clients[targetId];

      if (denied && denied.connection) {
        this.closeConnection(denied.connection);
      }
    } catch (error) {
      logEvent('message-join-deny', [clientId, error], 'error');
    }
  }
  // Append a device to the room's approved set, ignoring unusable ids
  // 把设备记入房间的已批准集合；id 不可用时直接忽略，避免污染集合
  rememberApprovedDevice(channel, deviceId) {
    if (!isString(deviceId)) {
      return;
    }

    if (!this.approved[channel]) {
      this.approved[channel] = new Set();
    }

    this.approved[channel].add(deviceId);
  }
  // Record when a room became empty, so its approved set can be reclaimed later
  // 记下房间变空的时刻，供日后回收它的已批准集合
  markApprovedVacancy(channel) {
    if (!this.approved[channel]) {
      return;
    }

    this.approvedEmptySince[channel] = Date.now();
  }
  // The room has members again, so it is no longer a reclamation candidate
  // 房间重新有人，不再是可回收的对象
  clearApprovedVacancy(channel) {
    delete this.approvedEmptySince[channel];
  }
  // Reclaim approved sets of rooms that have stayed empty long enough
  // 回收空置足够久的房间的已批准集合
  // 收回的时机挂在加入请求上而不是定时器或 alarm：alarm 需要写 state.storage，
  // 会破坏中转端零留存；定时器则要 DO 常驻，两者都不如「有活动时顺手清理」划算。
  sweepApprovedVacancy(now = Date.now()) {
    for (const channel in this.approvedEmptySince) {
      if (now - this.approvedEmptySince[channel] < APPROVED_VACANT_TTL) {
        continue;
      }

      delete this.approvedEmptySince[channel];
      delete this.approved[channel];
    }
  }
  // Tell every real member of the room that a pending request is gone
  // 通知房间内所有正式成员：某条候客申请已经不存在了
  broadcastPendingRemoved(channel, pendingId) {
    const members = this.channels[channel];

    if (!isArray(members)) {
      return;
    }

    for (const member of members) {
      if (this.isClientInChannel(this.clients[member], channel)) {
        this.sendEncrypted(member, { a: 'jq-', p: pendingId });
      }
    }
  }
  // 把客户端从候客池的所有房间列表中移除，并清空其候客字段。
  // 返回是否真的发生过移除，调用方无须自行猜测。
  removeClientFromPending(clientId) {
    const removedChannels = [];

    for (const channel in this.pending) {
      const waiting = this.pending[channel];

      if (!isArray(waiting)) {
        continue;
      }

      const index = waiting.indexOf(clientId);

      if (index !== -1) {
        waiting.splice(index, 1);
        removedChannels.push(channel);
      }

      if (waiting.length === 0) {
        delete(this.pending[channel]);
      }
    }

    const client = this.clients[clientId];

    if (client) {
      client.pendingRoom = null;
      client.pendingName = null;
    }

    // The removal judgement lives here because this is the only place that can tell a
    // real removal from a no-op, so callers (close, timeout, approve, deny) cannot
    // produce duplicate notifications. The approved client himself is not a member yet
    // at this point, so he receives jok only.
    // 是否真的移除只在这里判定：只有这里能区分真移除与空操作，四个调用点因此不会
    // 重复通知。此刻被批准者还不是房间成员，所以他只收到 jok，不会收到这条通知。
    for (const channel of removedChannels) {
      this.broadcastPendingRemoved(channel, clientId);
    }

    return removedChannels.length > 0;
  }
  // 按 clientId 发送加密消息，供审批流程复用
  sendEncrypted(clientId, messageObj) {
    const client = this.clients[clientId];

    if (!client || !client.shared) {
      return;
    }

    this.sendMessage(client.connection, encryptMessage(messageObj, client.shared));
  }
  // Handle client messages
  handleClientMessage(clientId, decrypted) {
    if (!isString(decrypted.p) || !isString(decrypted.c) || !this.clients[clientId].channel) {
      return;
    }

    try {
      const channel = this.clients[clientId].channel;
      const targetClient = this.clients[decrypted.c];

      if (this.isClientInChannel(targetClient, channel)) {
        const messageObj = {
          a: 'c',
          p: decrypted.p,
          c: clientId
        };

        const encrypted = encryptMessage(messageObj, targetClient.shared);
        this.sendMessage(targetClient.connection, encrypted);

        messageObj.p = null;
      }

    } catch (error) {
      logEvent('message-client', [clientId, error], 'error');
    }
  }  // Handle channel messages
  handleChannelMessage(clientId, decrypted) {
    if (!isObject(decrypted.p) || !this.clients[clientId].channel) {
      return;
    }
    
    try {
      const channel = this.clients[clientId].channel;
      // 过滤有效的目标成员
      const validMembers = Object.keys(decrypted.p).filter(member => {
        const targetClient = this.clients[member];
        return isString(decrypted.p[member]) && this.isClientInChannel(targetClient, channel);
      });

      // 处理所有有效的目标成员
      for (const member of validMembers) {
        const targetClient = this.clients[member];
        const messageObj = {
          a: 'c',
          p: decrypted.p[member],
          c: clientId
        };        const encrypted = encryptMessage(messageObj, targetClient.shared);
        this.sendMessage(targetClient.connection, encrypted);

        messageObj.p = null;
      }

    } catch (error) {
      logEvent('message-channel', [clientId, error], 'error');
    }
  }
  // Broadcast member list to channel
  broadcastMemberList(channel) {
    try {
      const members = this.channels[channel];

      for (const member of members) {
        const client = this.clients[member];

        if (this.isClientInChannel(client, channel)) {
          // me carries the receiver's own id: the list excludes self, so without it a
          // client can never learn its own clientId and cannot address itself or verify
          // the approval messages that name it.
          // me 是收件人自己的 id：名单排除了自己，不带上它客户端就永远不知道自己的
          // clientId，也无法据此校验那些点名自己的审批消息。
          const messageObj = {
            a: 'l',
            p: members.filter((value) => {
              return (value !== member ? true : false);
            }),
            me: member
          };

          const encrypted = encryptMessage(messageObj, client.shared);
          this.sendMessage(client.connection, encrypted);

          messageObj.p = null;
        }
      }
    } catch (error) {
      logEvent('broadcast-member-list', error, 'error');
    }
  }  // Check if client is in channel
  isClientInChannel(client, channel) {
    return (
      client &&
      client.connection &&
      client.shared &&
      client.channel &&
      client.channel === channel ?
      true :
      false
    );
  }
  // Send message helper
  sendMessage(connection, message) {
    try {
      // In Cloudflare Workers, WebSocket.READY_STATE_OPEN is 1
      if (connection.readyState === 1) {
        connection.send(message);
      }
    } catch (error) {
      logEvent('sendMessage', error, 'error');
    }
  }  // Close connection helper
  closeConnection(connection) {
    try {
      connection.close();    } catch (error) {
      logEvent('closeConnection', error, 'error');
    }
  }
  
  // 连接清理方法
  async cleanupOldConnections() {
    const seenThreshold = getTime() - this.config.seenTimeout;
    const clientsToRemove = [];

    // 先收集需要移除的客户端，避免在迭代时修改对象
    for (const clientId in this.clients) {
      if (this.clients[clientId].seen < seenThreshold) {
        clientsToRemove.push(clientId);
      }
    }

    // 然后一次性移除所有过期客户端
    for (const clientId of clientsToRemove) {
      try {
        logEvent('connection-seen', clientId, 'debug');

        // 删客户端之前先摘掉它在候客池和房间成员表里的登记：
        // 候客池不清会留下幽灵等待者；成员表不清则房间永远被人占着，
        // 后续新设备会一直等不到审批（新增审批流程后这里才会真正卡死）。
        // 超时候客者的 jq- 通知由 removeClientFromPending 统一发出，这里不再重复：
        // 四个摘除点共用同一份「是否真的移除」的判据，重复通知无从产生。
        this.removeClientFromPending(clientId);

        const channel = this.clients[clientId].channel;

        if (channel && this.channels[channel]) {
          const index = this.channels[channel].indexOf(clientId);

          if (index !== -1) {
            this.channels[channel].splice(index, 1);

            // 超时摘除与正常断线必须一致地刷新成员名单：只摘不广播的话，
            // 其他设备界面上会一直留着这个已经不在房间里的成员，
            // 向它发消息只会被服务端静默丢弃，直到下一次名单刷新才自愈。
            if (this.channels[channel].length > 0) {
              this.broadcastMemberList(channel);
            }
          }

          if (this.channels[channel].length === 0) {
            delete(this.channels[channel]);
            this.markApprovedVacancy(channel);
          }
        }

        this.clients[clientId].connection.close();
        delete this.clients[clientId];
      } catch (error) {
        logEvent('connection-seen', error, 'error');      }
    }
    
    return clientsToRemove.length; // 返回清理的连接数量
  }
}
