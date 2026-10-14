// NodeCrypt core cryptographic client for secure chat
// NodeCrypt 安全聊天的核心加密客户端

import {
	sha256
} from 'js-sha256';
import {
	ec as elliptic
} from 'elliptic';
import {
	ModeOfOperation
} from 'aes-js';
import chacha from 'js-chacha20';
import {
	Buffer
} from 'buffer';
window.Buffer = Buffer;

// 索要历史的窗口时长：房间里各同伴的密钥陆续就绪，这个窗口决定最晚等多久就停止索要
const HISTORY_WINDOW_MS = 10000;

// Main NodeCrypt class for secure communication
// 用于安全通信的 NodeCrypt 主类
class NodeCrypt {
	// Initialize NodeCrypt instance
	// 初始化 NodeCrypt 实例
	constructor(config = {}, callbacks = {}) {
		this.config = {
			rsaPublic: config.rsaPublic || '',
			wsAddress: config.wsAddress || '',
			reconnectDelay: config.reconnectDelay || 3000,
			pingInterval: config.pingInterval || 20000,
			debug: config.debug || false,
		};
		this.callbacks = {
			onServerClosed: callbacks.onServerClosed || null,
			onServerSecured: callbacks.onServerSecured || null,
			onClientSecured: callbacks.onClientSecured || null,
			onClientList: callbacks.onClientList || null,
			onClientMessage: callbacks.onClientMessage || null,
			onJoinPending: callbacks.onJoinPending || null,
			onJoinApproved: callbacks.onJoinApproved || null,
			onJoinDenied: callbacks.onJoinDenied || null,
			onJoinRequest: callbacks.onJoinRequest || null,
			onJoinRequestCancel: callbacks.onJoinRequestCancel || null,
			onHistorySyncStart: callbacks.onHistorySyncStart || null,
			onHistoryRequest: callbacks.onHistoryRequest || null,
			onHistoryData: callbacks.onHistoryData || null,
		};
		try {
			this.clientEc = new elliptic('curve25519')
		} catch (error) {
			this.logEvent('constructor', error, 'error')
		}
		this.serverKeys = null;
		this.serverShared = null;
		this.credentials = null;
		this.connection = null;
		this.reconnect = null;
		this.ping = null;
		this.channel = {};
		// 历史同步状态：进入房间后开一段索要窗口，窗口内每有一个同伴的会话密钥
		// 就绪就向它单独要一次，重连后由 resetHistoryState 复位。
		this.historyWindowOpen = false;
		this.historyWindowUsed = false;
		this.historyAsked = new Set();
		this.historyPeerCount = 0;
		this.historyTimer = null;
		this.setCredentials = this.setCredentials.bind(this);
		this.connect = this.connect.bind(this);
		this.destruct = this.destruct.bind(this);
		this.onOpen = this.onOpen.bind(this);
		this.onMessage = this.onMessage.bind(this);
		this.onError = this.onError.bind(this);
		this.onClose = this.onClose.bind(this);
		this.logEvent = this.logEvent.bind(this);
		this.isOpen = this.isOpen.bind(this);
		this.isClosed = this.isClosed.bind(this);
		this.startReconnect = this.startReconnect.bind(this);
		this.stopReconnect = this.stopReconnect.bind(this);
		this.startPing = this.startPing.bind(this);
		this.stopPing = this.stopPing.bind(this);
		this.disconnect = this.disconnect.bind(this);
		this.sendMessage = this.sendMessage.bind(this);
		this.sendChannelMessage = this.sendChannelMessage.bind(this);
		this.sendHistoryTo = this.sendHistoryTo.bind(this);
		this.approveJoin = this.approveJoin.bind(this);
		this.denyJoin = this.denyJoin.bind(this);
		this.encryptServerMessage = this.encryptServerMessage.bind(this);
		this.decryptServerMessage = this.decryptServerMessage.bind(this);
		this.encryptClientMessage = this.encryptClientMessage.bind(this);
		this.decryptClientMessage = this.decryptClientMessage.bind(this)
	}

	// Set user credentials (username, channel, password)
	// 设置用户凭证（用户名、频道、密码）
	// deviceId 可选：房间内设备用它认出已批准过的设备，缺省时按新设备处理
	setCredentials(username, channel, password, deviceId = null) {
		this.logEvent('setCredentials');
		try {
			this.credentials = {
				username: username,
				channel: sha256(channel),
				password: sha256(password),
				deviceId: deviceId
			}
		} catch (error) {
			this.logEvent('setCredentials', error, 'error');
			return (false)
		}
		return (true)
	}

	// Connect to the server
	// 连接到服务器
	connect() {
		if (!this.credentials) {
			return (false)
		}
		this.logEvent('connect', this.config.wsAddress);
		this.stopReconnect();
		this.stopPing();
		this.serverKeys = null;
		this.serverShared = null;
		this.channel = {};
		this.resetHistoryState();
		try {
			this.connection = new WebSocket(this.config.wsAddress);
			this.connection.onopen = this.onOpen;
			this.connection.onmessage = this.onMessage;
			this.connection.onerror = this.onError;
			this.connection.onclose = this.onClose
		} catch (error) {
			this.logEvent('connect', error, 'error');
			return (false)
		}
		return (true)
	}

	// Clean up and disconnect
	// 清理并断开连接
	destruct() {
		this.logEvent('destruct');
		this.stopReconnect();
		this.stopPing();
		this.reconnect = null;
		this.ping = null;
		this.config = {
			rsaPublic: '',
			wsAddress: '',
			reconnectDelay: 3000,
			pingInterval: 15000,
			debug: false,
		};
		this.callbacks.onServerClosed = null;
		this.callbacks.onServerSecured = null;
		this.callbacks.onClientSecured = null;
		this.callbacks.onClientList = null;
		this.callbacks.onClientMessage = null;
		this.callbacks.onJoinPending = null;
		this.callbacks.onJoinApproved = null;
		this.callbacks.onJoinDenied = null;
		this.callbacks.onJoinRequest = null;
		this.callbacks.onJoinRequestCancel = null;
		this.callbacks.onHistorySyncStart = null;
		this.callbacks.onHistoryRequest = null;
		this.callbacks.onHistoryData = null;
		this.clientEc = null;
		this.serverKeys = null;
		this.serverShared = null;
		this.credentials = null;
		this.connection.onopen = null;
		this.connection.onmessage = null;
		this.connection.onerror = null;
		this.connection.onclose = null;
		try {
			this.connection.removeAllListeners()
		} catch (error) {
			this.logEvent('destruct', error, 'error')
		}
		try {
			this.connection.close()
		} catch (error) {
			this.logEvent('destruct', error, 'error')
		}
		this.connection = null;
		this.channel = {};
		return (true)
	}

	// WebSocket open event handler
	// WebSocket 连接打开事件处理
	async onOpen() {
		this.logEvent('onOpen');
		this.startPing();
		try {
			this.serverKeys = await crypto.subtle.generateKey({
				name: 'ECDH',
				namedCurve: 'P-384'
			}, false, ['deriveKey', 'deriveBits']);
			this.serverShared = null;
			this.sendMessage(Buffer.from(await crypto.subtle.exportKey('raw', this.serverKeys.publicKey)).toString('hex'))
		} catch (error) {
			this.logEvent('onOpen', error, 'error')
		}
	}

	// WebSocket message event handler
	// WebSocket 消息事件处理
	async onMessage(event) {
		if (!event || !this.isString(event.data)) {
			return
		}
		if (event.data === 'pong') {
			return
		}
		this.logEvent('onMessage', event.data);
		try {
			const data = JSON.parse(event.data);
			if (data.type === 'server-key') {
				const result = await this.handleServerKey(data.key);
				if (!result) {
					return
				}
			}
		} catch (e) {}
		if (!this.serverShared) {
			const parts = event.data.split('|');
			if (!parts[0] || !parts[1]) {
				return
			}
			try {
				if (await crypto.subtle.verify({
						name: 'RSASSA-PKCS1-v1_5'
					}, await crypto.subtle.importKey('spki', Buffer.from(this.config.rsaPublic, 'base64'), {
						name: 'RSASSA-PKCS1-v1_5',
						hash: {
							name: 'SHA-256'
						}
					}, false, ['verify']), Buffer.from(parts[1], 'base64'), Buffer.from(parts[0], 'hex')) === true) {
					this.serverShared = Buffer.from(await crypto.subtle.deriveBits({
						name: 'ECDH',
						namedCurve: 'P-384',
						public: await crypto.subtle.importKey('raw', Buffer.from(parts[0], 'hex'), {
							name: 'ECDH',
							namedCurve: 'P-384'
						}, true, [])
					}, this.serverKeys.privateKey, 384)).slice(8, 40);
					const joinRequest = {
						a: 'jr',
						p: this.credentials.channel,
						n: this.credentials.username
					};
					if (this.isString(this.credentials.deviceId)) {
						// 设备身份交给服务端，已批准过的设备可跳过再次审批
						joinRequest.d = this.credentials.deviceId;
					}
					this.sendMessage(this.encryptServerMessage(joinRequest, this.serverShared));
					// 进入聊天界面改由收到 'jok'（房间内设备批准）时触发，
					// 否则等待界面来不及显示。
				}
			} catch (error) {
				this.logEvent('onMessage', error, 'error')
			}
			return
		}
		const serverDecrypted = this.decryptServerMessage(event.data, this.serverShared);
		this.logEvent('onMessage-server-decrypted', serverDecrypted);
		if (!this.isObject(serverDecrypted) || !this.isString(serverDecrypted.a)) {
			return
		}
		// 候客与批准流程：服务端受理、批准、拒绝、以及他人申请入房的通知
		if (serverDecrypted.a === 'jw') {
			if (this.callbacks.onJoinPending) {
				try {
					this.callbacks.onJoinPending()
				} catch (error) {
					this.logEvent('onMessage-join-pending-callback', error, 'error')
				}
			}
			return
		}
		if (serverDecrypted.a === 'jok') {
			if (this.callbacks.onJoinApproved) {
				try {
					this.callbacks.onJoinApproved()
				} catch (error) {
					this.logEvent('onMessage-join-approved-callback', error, 'error')
				}
			}
			if (this.callbacks.onServerSecured) {
				try {
					this.callbacks.onServerSecured()
				} catch (error) {
					this.logEvent('onMessage-server-secured-callback', error, 'error')
				}
			}
			return
		}
		if (serverDecrypted.a === 'jno') {
			if (this.callbacks.onJoinDenied) {
				try {
					this.callbacks.onJoinDenied(serverDecrypted.r)
				} catch (error) {
					this.logEvent('onMessage-join-denied-callback', error, 'error')
				}
			}
			return
		}
		if (serverDecrypted.a === 'jq') {
			if (this.callbacks.onJoinRequest && this.isString(serverDecrypted.c)) {
				try {
					this.callbacks.onJoinRequest(serverDecrypted.c, serverDecrypted.n)
				} catch (error) {
					this.logEvent('onMessage-join-request-callback', error, 'error')
				}
			}
			return
		}
		// 候客申请已不存在（对方断开、超时清理，或已被房间内设备处理）
		if (serverDecrypted.a === 'jq-' && this.isString(serverDecrypted.p)) {
			if (this.callbacks.onJoinRequestCancel) {
				try {
					this.callbacks.onJoinRequestCancel(serverDecrypted.p)
				} catch (error) {
					this.logEvent('onMessage-join-request-cancel-callback', error, 'error')
				}
			}
			return
		}
		if (serverDecrypted.a === 'l' && this.isArray(serverDecrypted.p)) {
			try {
				for (const clientId in this.channel) {
					if (serverDecrypted.p.indexOf(clientId) < 0) {
						delete(this.channel[clientId])
					}
				}
				let payloads = {};
				for (const clientId of serverDecrypted.p) {
					if (!this.channel[clientId]) {
						this.channel[clientId] = {
							username: null,
							keys: this.clientEc.genKeyPair(),
							shared: null,
						};
						payloads[clientId] = this.channel[clientId].keys.getPublic('hex')
					}
				}
				if (Object.keys(payloads).length > 0) {
					this.sendMessage(this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared))
				}
			} catch (error) {
				this.logEvent('onMessage-list', error, 'error')
			}
			// 只有「房间里已经有别人」时才需要索要历史：第一台设备无人可问，
			// 反过来向刚进来的新成员要历史，只会收到一份空回应、白弹一句「没有历史」。
			if (serverDecrypted.p.length > 0) {
				this.openHistoryWindow();
			}
			for (const peerId in this.channel) {
				this.requestHistoryFrom(peerId)
			}
			if (this.callbacks.onClientList) {
				let clients = [];
				// 先放自己那一项：服务端下发的名单按协议排除自己（见 worker 的 broadcastMemberList），
				// 但界面要显示「我」，而自己的 clientId 只有服务端新加的 me 字段能提供。
				// 少了这一项，成员列表永远认不出自己，me 字段与 myId 就都白改了。
				if (this.isString(serverDecrypted.me)) {
					clients.push({
						clientId: serverDecrypted.me,
						username: this.credentials.username
					})
				}
				for (const clientId in this.channel) {
					if (this.channel[clientId].shared && this.channel[clientId].username) {
						clients.push({
							clientId: clientId,
							username: this.channel[clientId].username
						})
					}
				}
				try {
					// 带上服务端给本客户端的 id，界面才能把自己从成员列表中区分出来
					this.callbacks.onClientList(clients, serverDecrypted.me)
				} catch (error) {
					this.logEvent('onMessage-client-list-callback', error, 'error')
				}
			}
			return
		}
		if (!this.isString(serverDecrypted.p) || !this.isString(serverDecrypted.c)) {
			return
		}
		if (serverDecrypted.a === 'c' && (!this.channel[serverDecrypted.c] || !this.channel[serverDecrypted.c].shared)) {
			try {
				if (!this.channel[serverDecrypted.c]) {
					this.channel[serverDecrypted.c] = {
						username: null,
						keys: this.clientEc.genKeyPair(),
						shared: null,
					};
					this.sendMessage(this.encryptServerMessage({
						a: 'c',
						p: this.channel[serverDecrypted.c].keys.getPublic('hex'),
						c: serverDecrypted.c
					}, this.serverShared))
				}
				this.channel[serverDecrypted.c].shared = Buffer.from(this.xorHex(this.channel[serverDecrypted.c].keys.derive(this.clientEc.keyFromPublic(serverDecrypted.p, 'hex').getPublic()).toString('hex').padEnd(64, '8').substr(0, 64), this.credentials.password), 'hex');
				this.sendMessage(this.encryptServerMessage({
					a: 'c',
					p: this.encryptClientMessage({
						a: 'u',
						p: this.credentials.username
					}, this.channel[serverDecrypted.c].shared),
					c: serverDecrypted.c
				}, this.serverShared))
				// 这个同伴的会话密钥刚就绪，窗口还开着就向它要一次历史
				this.requestHistoryFrom(serverDecrypted.c)
			} catch (error) {
				this.logEvent('onMessage-client', error, 'error')
			}
			return
		}
		if (serverDecrypted.a === 'c' && this.channel[serverDecrypted.c] && this.channel[serverDecrypted.c].shared) {
			const clientDecrypted = this.decryptClientMessage(serverDecrypted.p, this.channel[serverDecrypted.c].shared);
			this.logEvent('onMessage-client-decrypted', clientDecrypted);
			if (!this.isObject(clientDecrypted) || !this.isString(clientDecrypted.a)) {
				return
			}
			if (clientDecrypted.a === 'u' && this.isString(clientDecrypted.p) && clientDecrypted.p.match(/\S+/) && !this.channel[serverDecrypted.c].username) {
				this.channel[serverDecrypted.c].username = clientDecrypted.p.replace(/^\s+/, '').replace(/\s+$/, '');
				if (this.callbacks.onClientSecured) {
					try {
						this.callbacks.onClientSecured({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username
						})
					} catch (error) {
						this.logEvent('onMessage-client-secured-callback', error, 'error')
					}
				}
				return
			}			// 历史同步请求与回应都不依赖对方是否已上报设备名：新设备刚进房间时
			// 可能还没收到任何 u，若用设备名当门槛，同步会被整个挡掉。
			if (clientDecrypted.a === 'hq') {
				if (this.callbacks.onHistoryRequest) {
					try {
						this.callbacks.onHistoryRequest(serverDecrypted.c)
					} catch (error) {
						this.logEvent('onMessage-history-request-callback', error, 'error')
					}
				}
				return
			}
			if (clientDecrypted.a === 'h' && this.isArray(clientDecrypted.d)) {
				if (this.callbacks.onHistoryData) {
					try {
						this.callbacks.onHistoryData(serverDecrypted.c, clientDecrypted.d)
					} catch (error) {
						this.logEvent('onMessage-history-data-callback', error, 'error')
					}
				}
				return
			}
			if (!this.channel[serverDecrypted.c].username) {
				return
			}
			if (clientDecrypted.a === 'm' && this.isString(clientDecrypted.t) && (this.isString(clientDecrypted.d) || this.isObject(clientDecrypted.d))) {
				if (this.callbacks.onClientMessage) {
					try {
						this.callbacks.onClientMessage({
							clientId: serverDecrypted.c,
							username: this.channel[serverDecrypted.c].username,
							type: clientDecrypted.t,
							data: clientDecrypted.d
						})
					} catch (error) {
						this.logEvent('onMessage-client-message-callback', error, 'error')
					}
				}
				return
			}
		}
	}

	// WebSocket error event handler
	// WebSocket 错误事件处理
	async onError(event) {
		this.logEvent('onError', event, 'error');
		this.disconnect();
		if (this.credentials) {
			this.startReconnect()
		}
		if (this.callbacks.onServerClosed) {
			try {
				this.callbacks.onServerClosed()
			} catch (error) {
				this.logEvent('onError-server-closed-callback', error, 'error')
			}
		}
	}

	// WebSocket close event handler
	// WebSocket 关闭事件处理
	async onClose(event) {
		this.logEvent('onClose', event);
		this.disconnect();
		if (this.credentials) {
			this.startReconnect()
		}
		if (this.callbacks.onServerClosed) {
			try {
				this.callbacks.onServerClosed()
			} catch (error) {
				this.logEvent('onClose-server-closed-callback', error, 'error')
			}
		}
	}

	// Log events for debugging
	// 记录事件日志用于调试
	logEvent(source, message, level) {
		if (this.config.debug) {
			const date = new Date(),
				dateString = date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2) + ' ' + ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2) + ':' + ('0' + date.getSeconds()).slice(-2);
			console.log('[' + dateString + ']', (level ? level.toUpperCase() : 'INFO'), source + (message ? ':' : ''), (message ? message : ''))
		}
	}

	// Check if connection is open
	// 检查连接是否已打开
	isOpen() {
		return (this.connection && this.connection.readyState && this.connection.readyState === WebSocket.OPEN ? true : false)
	}

	// Check if connection is closed
	// 检查连接是否已关闭
	isClosed() {
		return (!this.connection || !this.connection.readyState || this.connection.readyState === WebSocket.CLOSED ? true : false)
	}

	// Start reconnect timer
	// 启动重连定时器
	startReconnect() {
		this.stopReconnect();
		this.logEvent('startReconnect');
		this.reconnect = setTimeout(() => {
			this.reconnect = null;
			this.connect()
		}, this.config.reconnectDelay)
	}

	// Stop reconnect timer
	// 停止重连定时器
	stopReconnect() {
		if (this.reconnect) {
			this.logEvent('stopReconnect');
			clearTimeout(this.reconnect);
			this.reconnect = null
		}
	}

	// Start ping timer
	// 启动心跳定时器
	startPing() {
		this.stopPing();
		this.logEvent('startPing');
		this.ping = setInterval(() => {
			this.sendMessage('ping')
		}, this.config.pingInterval)
	}

	// Stop ping timer
	// 停止心跳定时器
	stopPing() {
		if (this.ping) {
			this.logEvent('stopPing');
			clearInterval(this.ping);
			this.ping = null
		}
	}

	// Disconnect from server
	// 从服务器断开连接
	disconnect() {
		this.stopReconnect();
		this.stopPing();
		this.resetHistoryState();
		if (!this.isClosed()) {
			try {
				this.logEvent('disconnect');
				this.connection.close()
			} catch (error) {
				this.logEvent('disconnect', error, 'error')
			}
		}
	}

	// Send a message to the server
	// 向服务器发送消息
	sendMessage(message) {
		try {
			if (this.isOpen()) {
				this.connection.send(message);
				return (true)
			}
		} catch (error) {
			this.logEvent('sendMessage', error, 'error')
		}
		return (false)
	}

	// Send a message to all channels
	// 向所有频道发送消息
	sendChannelMessage(type, data) {
		return (this.sendChannelAction('m', type, data, true))
	}

	// Broadcast an inner action to every peer whose session key is ready
	// 把一个内层动作群发给所有会话密钥已就绪的成员
	// 抽出通用实现而不是直接改 sendChannelMessage：'m' 要求对方已上报设备名，
	// 'hq' 只要密钥协商完成就该发；两者挤在一个函数里会让字段要求互相纠缠。
	sendChannelAction(action, type, data, requireUsername) {
		if (this.serverShared) {
			try {
				let payloads = {};
				for (const clientId in this.channel) {
					const peer = this.channel[clientId];
					if (!peer.shared || (requireUsername && !peer.username)) {
						continue
					}
					payloads[clientId] = action === 'm' ?
						this.encryptClientMessage({
							a: 'm',
							t: type,
							d: data
						}, peer.shared) :
						this.encryptClientMessage({
							a: action
						}, peer.shared);
					if (payloads[clientId].length === 0) {
						return (false)
					}
				}
				if (Object.keys(payloads).length > 0) {
					const payload = this.encryptServerMessage({
						a: 'w',
						p: payloads,
					}, this.serverShared);
					if (!this.isOpen() || payload.length === 0 || payload.length > (8 * 1024 * 1024)) {
						return (false)
					}
					this.connection.send(payload)
				}
				return (true)
			} catch (error) {
				this.logEvent('sendChannelAction', error, 'error')
			}
		}
		return (false)
	}

	// Clear per-connection history sync state
	// 复位每次连接的历史同步状态
	resetHistoryState() {
		this.historyWindowOpen = false;
		this.historyWindowUsed = false;
		this.historyAsked = new Set();
		this.historyPeerCount = 0;
		if (this.historyTimer) {
			clearTimeout(this.historyTimer);
			this.historyTimer = null
		}
	}

	// Open this connection's single window during which history may be requested
	// 打开本次连接唯一的「索要历史」窗口
	// 不用固定延时的原因：名单一到就发，此刻 this.channel 里全是刚建好、shared
	// 仍为空的条目，请求会发给零个成员；而延时到点若密钥依旧没就绪，请求同样落空
	// 且不会重来。改成等每个同伴的密钥就绪后各要一次，既不赌时间，也不会反复问。
	openHistoryWindow() {
		if (this.historyWindowUsed) {
			return
		}
		this.historyWindowUsed = true;
		this.historyWindowOpen = true;
		// 兜底关闭：房间里始终没人回应时不能一直挂着，也就不用留下常驻定时器
		this.historyTimer = setTimeout(() => {
			this.historyTimer = null;
			this.historyWindowOpen = false
		}, HISTORY_WINDOW_MS)
	}

	// Ask one peer for its history, at most once per connection
	// 向某一个同伴索要历史，每次连接对它最多问一次
	requestHistoryFrom(clientId) {
		if (!this.historyWindowOpen || this.historyAsked.has(clientId)) {
			return
		}
		const peer = this.channel[clientId];
		if (!peer || !peer.shared || !this.serverShared) {
			return
		}
		const message = this.encryptServerMessage({
			a: 'c',
			p: this.encryptClientMessage({
				a: 'hq'
			}, peer.shared),
			c: clientId
		}, this.serverShared);
		if (!this.isOpen() || message.length === 0) {
			return
		}
		this.historyAsked.add(clientId);
		this.connection.send(message);
		this.historyPeerCount = this.historyAsked.size;
		// 第一台设备没有同伴可问，此时连提示都不该发：看到「正在同步历史」
		// 却永远等不到结果只会让人困惑
		if (this.callbacks.onHistorySyncStart) {
			try {
				this.callbacks.onHistorySyncStart(this.historyPeerCount)
			} catch (error) {
				this.logEvent('onMessage-history-sync-start-callback', error, 'error')
			}
		}
	}

	// Reply with local history to one requesting peer
	// 把本地历史点对点回给某个请求者
	sendHistoryTo(clientId, entries) {
		try {
			const peer = this.channel[clientId];
			if (!peer || !peer.shared || !this.serverShared) {
				return (false)
			}
			const message = this.encryptServerMessage({
				a: 'c',
				p: this.encryptClientMessage({
					a: 'h',
					d: entries
				}, peer.shared),
				c: clientId
			}, this.serverShared);
			if (!this.isOpen() || message.length === 0 || message.length > (8 * 1024 * 1024)) {
				return (false)
			}
			this.connection.send(message);
			return (true)
		} catch (error) {
			this.logEvent('sendHistoryTo', error, 'error')
		}
		return (false)
	}

	// Approve a pending join request
	// 批准某个候客设备的加入申请
	approveJoin(clientId) {
		this.logEvent('approveJoin', clientId);
		if (!this.serverShared || !this.isString(clientId)) {
			return (false)
		}
		return (this.sendMessage(this.encryptServerMessage({
			a: 'ja',
			c: clientId
		}, this.serverShared)))
	}

	// Deny a pending join request
	// 拒绝某个候客设备的加入申请
	denyJoin(clientId) {
		this.logEvent('denyJoin', clientId);
		if (!this.serverShared || !this.isString(clientId)) {
			return (false)
		}
		return (this.sendMessage(this.encryptServerMessage({
			a: 'jn',
			c: clientId
		}, this.serverShared)))
	}

	// Encrypt a message for the server
	// 加密发送给服务器的消息
	encryptServerMessage(message, key) {
		let encrypted = '';
		try {
			message = Buffer.from(JSON.stringify(message), 'utf8');
			if ((message.length % 16) !== 0) {
				message = Buffer.from([...message, ...Buffer.alloc(16 - (message.length % 16))])
			}
			const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
			const cipher = new ModeOfOperation.cbc(key, iv);
			encrypted = iv.toString('base64') + '|' + Buffer.from(cipher.encrypt(message)).toString('base64')
		} catch (error) {
			this.logEvent('encryptServerMessage', error, 'error')
		}
		return (encrypted)
	}

	// Decrypt a message from the server
	// 解密来自服务器的消息
	decryptServerMessage(message, key) {
		let decrypted = {};
		try {
			const parts = message.split('|');
			const decipher = new ModeOfOperation.cbc(key, Buffer.from(parts[0], 'base64'));
			decrypted = JSON.parse(Buffer.from(decipher.decrypt(Buffer.from(parts[1], 'base64'))).toString('utf8').replace(/\0+$/, ''))
		} catch (error) {
			this.logEvent('decryptServerMessage', error, 'error')
		}
		return (decrypted)
	}

	// Encrypt a message for a client
	// 加密发送给客户端的消息
	encryptClientMessage(message, key) {
		let encrypted = '';
		try {
			message = Buffer.from(JSON.stringify(message), 'utf8');
			if ((message.length % 16) !== 0) {
				message = Buffer.from([...message, ...Buffer.alloc(16 - (message.length % 16))])
			}
			const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
			const counter = Buffer.from(crypto.getRandomValues(new Uint8Array(4)));
			const cipher = new chacha(key, iv, counter.reduce((a, b) => a * b));
			encrypted = iv.toString('base64') + '|' + counter.toString('base64') + '|' + Buffer.from(cipher.encrypt(message)).toString('base64')
		} catch (error) {
			this.logEvent('encryptClientMessage', error, 'error')
		}
		return (encrypted)
	}

	// Decrypt a message from a client
	// 解密来自客户端的消息
	decryptClientMessage(message, key) {
		let decrypted = {};
		try {
			const parts = message.split('|');
			const decipher = new chacha(key, Buffer.from(parts[0], 'base64'), Buffer.from(parts[1], 'base64').reduce((a, b) => a * b));
			decrypted = JSON.parse(Buffer.from(decipher.decrypt(Buffer.from(parts[2], 'base64'))).toString('utf8').replace(/\0+$/, ''))
		} catch (error) {
			this.logEvent('decryptClientMessage', error, 'error')
		}
		return (decrypted)
	}

	// XOR two hex strings
	// 对两个十六进制字符串进行异或
	xorHex(a, b) {
		let result = '',
			hexLength = Math.min(a.length, b.length);
		for (let i = 0; i < hexLength; ++i) {
			result += (parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16)).toString(16)
		}
		return (result)
	}

	// Check if value is a string
	// 检查值是否为字符串
	isString(value) {
		return (value && Object.prototype.toString.call(value) === '[object String]' ? true : false)
	}

	// Check if value is an array
	// 检查值是否为数组
	isArray(value) {
		return (value && Object.prototype.toString.call(value) === '[object Array]' ? true : false)
	}

	// Check if value is an object
	// 检查值是否为对象
	isObject(value) {
		return (value && Object.prototype.toString.call(value) === '[object Object]' ? true : false)
	}

	// Handle server public key
	// 处理服务器公钥
	async handleServerKey(serverKey) {
		this.logEvent('handleServerKey', 'Received server key');
		this.config.rsaPublic = serverKey;
		return true
	}
};

if (typeof window !== 'undefined') {
	window.NodeCrypt = NodeCrypt
}