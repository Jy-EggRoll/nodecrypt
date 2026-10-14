// Room management logic for NodeCrypt web client
// NodeCrypt 网页客户端的房间管理逻辑

import {
	createAvatarSVG
} from './util.avatar.js';
import {
	renderChatArea,
	addSystemMsg,
	updateChatInputStyle
} from './chat.js';
import {
	renderMainHeader,
	renderUserList,
	showWaitingRoom,
	hideWaitingRoom,
	showJoinApproval,
	hideJoinApproval,
	getDeviceId
} from './ui.js';
import {
	escapeHTML
} from './util.string.js';
import {
	$id,
	createElement
} from './util.dom.js';
import { t } from './util.i18n.js';
let roomsData = [];
let activeRoomIndex = -1;

// Get a new room data object
// 获取一个新的房间数据对象
export function getNewRoomData() {
	return {
		roomName: '',
		userList: [],
		userMap: {},
		myId: null,
		myUserName: '',
		chat: null,
		messages: [],
		prevUserList: [],
		knownUserIds: new Set(),
		unreadCount: 0,
		privateChatTargetId: null,
		privateChatTargetName: null
	}
}

// Switch to another room by index
// 切换到指定索引的房间
export function switchRoom(index) {
	if (index < 0 || index >= roomsData.length) return;
	activeRoomIndex = index;
	const rd = roomsData[index];
	if (typeof rd.unreadCount === 'number') rd.unreadCount = 0;
	const sidebarUsername = document.getElementById('sidebar-username');
	if (sidebarUsername) sidebarUsername.textContent = rd.myUserName;
	setSidebarAvatar(rd.myUserName);
	renderRooms(index);
	renderMainHeader();
	renderUserList(false);
	renderChatArea();
	updateChatInputStyle()
}

// Set the sidebar avatar
// 设置侧边栏头像
export function setSidebarAvatar(userName) {
	if (!userName) return;
	const svg = createAvatarSVG(userName);
	const el = $id('sidebar-user-avatar');
	if (el) {
		const cleanSvg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		el.innerHTML = cleanSvg
	}
}

// Render the room list
// 渲染房间列表
export function renderRooms(activeId = 0) {
	const roomList = $id('room-list');
	roomList.innerHTML = '';
	roomsData.forEach((rd, i) => {
		const div = createElement('div', {
			class: 'room' + (i === activeId ? ' active' : ''),
			onclick: () => switchRoom(i)
		});
		const safeRoomName = escapeHTML(rd.roomName);
		let unreadHtml = '';
		if (rd.unreadCount && i !== activeId) {
			unreadHtml = `<span class="room-unread-badge">${rd.unreadCount>99?'99+':rd.unreadCount}</span>`
		}
		div.innerHTML = `<div class="info"><div class="title">#${safeRoomName}</div></div>${unreadHtml}`;
		roomList.appendChild(div)
	})
}

// Join a room
// 加入一个房间
export function joinRoom(userName, roomName, password, modal = null, onResult) {
	const newRd = getNewRoomData();
	newRd.roomName = roomName;
	newRd.myUserName = userName;
	newRd.password = password;
	roomsData.push(newRd);
	const idx = roomsData.length - 1;
	switchRoom(idx);
	const sidebarUsername = $id('sidebar-username');
	if (sidebarUsername) sidebarUsername.textContent = userName;
	setSidebarAvatar(userName);
	let closed = false;
	const callbacks = {
		onServerClosed: () => {
			setStatus('Node connection closed');
			if (onResult && !closed) {
				closed = true;
				onResult(false)
			}
		},		onServerSecured: () => {
			if (modal) modal.remove();
			else {
				const loginContainer = $id('login-container');
				if (loginContainer) loginContainer.style.display = 'none';
				const chatContainer = $id('chat-container');
				if (chatContainer) chatContainer.style.display = '';
				

			}
			if (onResult && !closed) {
				closed = true;
				onResult(true)
			}
			addSystemMsg(t('system.secured', 'connection secured'))
		},
		onClientSecured: (user) => handleClientSecured(idx, user),
		onClientList: (list, selfId) => handleClientList(idx, list, selfId),
		onClientLeft: (clientId) => handleClientLeft(idx, clientId),
		onClientMessage: (msg) => handleClientMessage(idx, msg),
		onJoinPending: () => showWaitingRoom(userName),
		onJoinApproved: () => hideWaitingRoom(),
		onJoinDenied: (reason) => handleJoinDenied(idx, reason),
		onJoinRequest: (clientId, name) => showJoinApproval(roomsData[idx].chat, name, clientId),
		onJoinRequestCancel: (clientId) => hideJoinApproval(clientId),
		onHistorySyncStart: () => handleHistorySyncStart(idx),
		onHistoryRequest: (clientId) => handleHistoryRequest(idx, clientId),
		onHistoryData: (clientId, entries) => handleHistoryData(idx, clientId, entries)
	};
	const chatInst = new window.NodeCrypt(window.config, callbacks);
	// 设备 id 一并交给 NodeCrypt，发 'jr' 时随申请上报
	chatInst.setCredentials(userName, roomName, password, getDeviceId());
	chatInst.connect();
	roomsData[idx].chat = chatInst
}

// Handle the join request being denied by the room
// 处理加入申请被房间内设备拒绝
export function handleJoinDenied(idx, reason) {
	hideWaitingRoom();
	const rd = roomsData[idx];
	if (rd && rd.chat && typeof rd.chat.destruct === 'function') {
		rd.chat.destruct();
	}
	if (rd) rd.chat = null;
	const at = roomsData.indexOf(rd);
	if (at >= 0) roomsData.splice(at, 1);
	if (roomsData.length > 0) {
		switchRoom(0);
	} else {
		const loginContainer = $id('login-container');
		if (loginContainer) loginContainer.style.display = '';
		document.body.classList.add('login-page');
	}
	// 退回登录层后给出提示，说明本次申请的结果
	const message = reason || t('system.join_denied', 'Your join request was denied');
	setTimeout(() => {
		if (window.addSystemMsg) window.addSystemMsg(message, true);
	}, 0);
}

// The waiting-room cancel button is rendered in index.html at page load,
// so it needs a listener independent of joinRoom.
// 等待界面的取消按钮写在 index.html 里，页面加载后就存在，
// 因此它的监听不能放在 joinRoom 内部。
function handleWaitingCancel() {
	hideWaitingRoom();
	const hasRoom = activeRoomIndex >= 0 && roomsData[activeRoomIndex];
	// 先记录是否还有其他房间，决定是回登录层还是切到别的房间
	const exitsToLogin = roomsData.length <= 1 || !hasRoom;
	if (hasRoom) {
		exitRoom();
	}
	if (exitsToLogin) {
		const loginContainer = $id('login-container');
		if (loginContainer) loginContainer.style.display = '';
		document.body.classList.add('login-page');
	}
}

window.addEventListener('DOMContentLoaded', () => {
	const cancelBtn = $id('waiting-cancel-btn');
	if (cancelBtn) cancelBtn.onclick = handleWaitingCancel;
});

// Handle the client list update
// 处理客户端列表更新
export function handleClientList(idx, list, selfId) {
	const rd = roomsData[idx];
	if (!rd) return;
	const oldUserIds = new Set((rd.userList || []).map(u => u.clientId));
	const newUserIds = new Set(list.map(u => u.clientId));
	for (const oldId of oldUserIds) {
		if (!newUserIds.has(oldId)) {
			handleClientLeft(idx, oldId)
		}
	}
	rd.userList = list;
	rd.userMap = {};
	list.forEach(u => {
		rd.userMap[u.clientId] = u
	});
	rd.myId = selfId;
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
	rd.initCount = (rd.initCount || 0) + 1;
	if (rd.initCount === 2) {
		rd.isInitialized = true;
		rd.knownUserIds = new Set(list.map(u => u.clientId))
	}
}

// Handle client secured event
// 处理客户端安全连接事件
export function handleClientSecured(idx, user) {
	const rd = roomsData[idx];
	if (!rd) return;
	rd.userMap[user.clientId] = user;
	const existingUserIndex = rd.userList.findIndex(u => u.clientId === user.clientId);
	if (existingUserIndex === -1) {
		rd.userList.push(user)
	} else {
		rd.userList[existingUserIndex] = user
	}
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
	if (!rd.isInitialized) {
		return
	}
	const isNew = !rd.knownUserIds.has(user.clientId);
	if (isNew) {
		rd.knownUserIds.add(user.clientId);		const name = user.userName || user.username || user.name || t('ui.anonymous', 'Anonymous');
		const msg = `${name} ${t('system.joined', 'joined the conversation')}`;
		rd.messages.push({
			type: 'system',
			text: msg
		});
		if (activeRoomIndex === idx) addSystemMsg(msg, true);
		if (window.notifyMessage) {
			window.notifyMessage(rd.roomName, 'system', msg)
		}
	}
}

// Handle client left event
// 处理客户端离开事件
export function handleClientLeft(idx, clientId) {
	const rd = roomsData[idx];
	if (!rd) return;
	if (rd.privateChatTargetId === clientId) {
		rd.privateChatTargetId = null;
		rd.privateChatTargetName = null;
		if (activeRoomIndex === idx) {
			updateChatInputStyle()
		}
	}
	const user = rd.userMap[clientId];
	const name = user ? (user.userName || user.username || user.name || 'Anonymous') : 'Anonymous';
	const msg = `${name} ${t('system.left', 'left the conversation')}`;
	rd.messages.push({
		type: 'system',
		text: msg
	});
	if (activeRoomIndex === idx) addSystemMsg(msg, true);
	rd.userList = rd.userList.filter(u => u.clientId !== clientId);
	delete rd.userMap[clientId];
	if (activeRoomIndex === idx) {
		renderUserList(false);
		renderMainHeader()
	}
}

// Handle client message event
// 处理客户端消息事件
export function handleClientMessage(idx, msg) {
	const newRd = roomsData[idx];
	if (!newRd) return;

	// Prevent processing own messages unless it's a private message sent to oneself
	if (msg.clientId === newRd.myId && msg.userName === newRd.myUserName && !msg.type.includes('_private')) {
		return;
	}

	let msgType = msg.type || 'text';

	// Handle file messages
	if (msgType.startsWith('file_')) {
		// Part 1: Update message history and send notifications (for 'file_start' type)
		if (msgType === 'file_start' || msgType === 'file_start_private') {
			let realUserName = msg.userName;
			if (!realUserName && msg.clientId && newRd.userMap[msg.clientId]) {
				realUserName = newRd.userMap[msg.clientId].userName || newRd.userMap[msg.clientId].username || newRd.userMap[msg.clientId].name;
			}
			const historyMsgType = msgType === 'file_start_private' ? 'file_private' : 'file';
			
			const fileId = msg.data && msg.data.fileId;
			if (fileId) { // Only proceed if we have a fileId
				const messageAlreadyInHistory = newRd.messages.some(
					m => m.msgType === historyMsgType && m.text && m.text.fileId === fileId && m.userName === realUserName
				);

				if (!messageAlreadyInHistory) {
					newRd.messages.push({
						type: 'other',
						text: msg.data, // This is the file metadata object
						userName: realUserName,
						avatar: realUserName,
						msgType: historyMsgType,
						timestamp: (msg.data && msg.data.timestamp) || Date.now() 
					});
				}
			}

			const notificationMsgType = msgType.includes('_private') ? 'private file' : 'file';
			if (window.notifyMessage && msg.data && msg.data.fileName) {
				window.notifyMessage(newRd.roomName, notificationMsgType, `${msg.data.fileName}`, realUserName);
			}
		}

		// Part 2: Handle UI interaction (rendering in active room, or unread count in inactive room)
		if (activeRoomIndex === idx) {
			// If it's the active room, delegate to util.file.js to handle UI and file transfer state.
			// This applies to all file-related messages (file_start, file_volume, file_end, etc.)
			if (window.handleFileMessage) {
				window.handleFileMessage(msg.data, msgType.includes('_private'));
			}
		} else {
			// If it's not the active room, only increment unread count for 'file_start' messages.
			if (msgType === 'file_start' || msgType === 'file_start_private') {
				newRd.unreadCount = (newRd.unreadCount || 0) + 1;
				renderRooms(activeRoomIndex);
			}
		}
		return; // File messages are fully handled.
	}

	// Handle image messages (both new and legacy formats)
	if (msgType === 'image' || msgType === 'image_private') {
		// Already has correct type
	} else if (!msgType.includes('_private')) {
		// Handle legacy image detection
		if (msg.data && typeof msg.data === 'string' && msg.data.startsWith('data:image/')) {
			msgType = 'image';
		} else if (msg.data && typeof msg.data === 'object' && msg.data.image) {
			msgType = 'image';
		}
	}
	let realUserName = msg.userName;
	if (!realUserName && msg.clientId && newRd.userMap[msg.clientId]) {
		realUserName = newRd.userMap[msg.clientId].userName || newRd.userMap[msg.clientId].username || newRd.userMap[msg.clientId].name;
	}

	// Add message to messages array for chat history
	roomsData[idx].messages.push({
		type: 'other',
		text: msg.data,
		userName: realUserName,
		avatar: realUserName,
		msgType: msgType,
		timestamp: Date.now()
	});

	// Only add message to chat display if it's for the active room
	if (activeRoomIndex === idx) {
		if (window.addOtherMsg) {
			window.addOtherMsg(msg.data, realUserName, realUserName, false, msgType);
		}
	} else {
		roomsData[idx].unreadCount = (roomsData[idx].unreadCount || 0) + 1;
		renderRooms(activeRoomIndex);
	}

	const notificationMsgType = msgType.includes('_private') ? `private ${msgType.split('_')[0]}` : msgType;
	if (window.notifyMessage) {
		window.notifyMessage(newRd.roomName, notificationMsgType, msg.data, realUserName);
	}
}

// How many entries a single history reply may carry, and the total size cap
// 单次历史回应最多携带的条目数，以及总体积上限
const HISTORY_MAX_ENTRIES = 500;
// 载荷要经内层、外层两次 base64，体积约膨胀到 1.9 倍；按 8 MB 卡条目的话，
// 序列化后会被传输层的 8 MB 判据整包丢掉，回应者等于没答复。故按一半留出余量。
const HISTORY_MAX_BYTES = 4 * 1024 * 1024;
const HISTORY_WAIT_MS = 800;

// New room data holders for the history exchange, filled lazily
// 历史交换的房间级中间状态，按需建立
function startHistoryCollection(idx) {
	const rd = roomsData[idx];
	if (!rd) return;
	rd.history = {
		responses: [],
		timer: null
	};
	if (activeRoomIndex === idx) {
		// isHistory 为真表示只画一次、不进记录：否则这句提示会随着历史传给别的设备，
		// 让别人看到一句莫名的「正在同步历史消息」
		addSystemMsg(t('system.history_syncing', 'Syncing history'), true, Date.now());
	}
}

// Pick the entries that are allowed to travel with a history reply
// 挑出允许随历史回应传递的条目
// 同步范围的取舍，三类各有原因：
// 私聊内容一律不带：回应历史时对任何询问者都答，带上私聊等于让房间内任意设备
// 都能拿到别人的私聊记录，所以这里只认 msgType 恰为 text 的公开文本。
// 文件卡不带：卡里只有文件名这类线索，字节在分卷消息里，而分卷从不进入消息记录，
// 传过去只会变成点开拿不到数据的卡片。
// 图片不带的原因与上面不同，是体积不是可读性：图片内容整段内联在条目里，
// 两次 base64 后约膨胀 1.9 倍，很容易顶掉下面的体积预算。
function collectSyncableEntries(rd) {
	const list = (rd && rd.messages) || [];
	const entries = [];
	let bytes = 0;
	// 从最新往前取：既满足「最多最近 500 条」，也保证超体积时留下的是最近的那一段
	for (let i = list.length - 1; i >= 0 && entries.length < HISTORY_MAX_ENTRIES; i--) {
		const msg = list[i];
		let entry = null;
		if (msg.type === 'system') {
			entry = {
				type: 'system',
				text: msg.text
			}
		} else if ((msg.type === 'other' || msg.type === 'me') && msg.msgType === 'text') {
			// 自己发出的消息在本地记作 type 'me'，但对收历史的一方来说就是他人消息，
			// 必须在这里转成 'other' 并补上自己的设备名——漏掉它的话，设备之间
			// 传来的将只有系统提示，真正的对话内容一条都同步不出去。
			const mine = msg.type === 'me';
			entry = {
				type: 'other',
				text: msg.text,
				userName: mine ? (rd.myUserName || '') : msg.userName,
				avatar: mine ? (rd.myUserName || '') : msg.avatar,
				msgType: msg.msgType,
				// addOtherMsg 在 isHistory 为真且取不到时间戳时会直接不渲染，
				// 这里补一个兜底，避免少数缺时间戳的旧记录在同步后凭空消失
				timestamp: msg.timestamp || Date.now()
			}
		}
		if (!entry) continue;
		const size = JSON.stringify(entry).length + 1;
		if (bytes + size > HISTORY_MAX_BYTES) {
			break
		}
		bytes += size;
		entries.push(entry)
	}
	return entries.reverse()
}

// Serve a peer's history request from this device's own memory
// 用本设备内存里的记录回应同伴的历史请求
// 服务端一个字节都不存：历史只能在设备之间点对点流传。
function handleHistoryRequest(idx, clientId) {
	const rd = roomsData[idx];
	if (!rd || !rd.chat) return;
	// 空数组也要回：请求者靠「回应者是否都答复过」决定何时停止等待。
	// 回包因体积被传输层拒掉时也补一个空回包，否则请求者会把这个回应者
	// 当成没答复而一直等下去
	const entries = collectSyncableEntries(rd);
	if (!rd.chat.sendHistoryTo(clientId, entries)) {
		rd.chat.sendHistoryTo(clientId, [])
	}
}

// Begin collecting history replies
// 开始收集历史回应
export function handleHistorySyncStart(idx) {
	startHistoryCollection(idx)
}

// Collect one history reply, finishing early once every asked peer answered
// 收集一份历史回应；所有被问到的设备都答复后提前结束
export function handleHistoryData(idx, clientId, entries) {
	const rd = roomsData[idx];
	if (!rd || !rd.history || !Array.isArray(entries)) return;
	rd.history.responses.push(entries);
	// 各家历史长短不一，等满窗口再决定用哪一份。
	// 不再用「回应者数量」提前收尾：请求是随着各同伴的密钥逐个就绪才发出的，
	// 总数在过程中会变，拿它当判据会提前结束、漏掉晚到的那一份。
	if (!rd.history.timer) {
		rd.history.timer = setTimeout(() => finishHistory(idx), HISTORY_WAIT_MS)
	}
}

// Render the longest reply and drop the rest
// 只渲染条数最多的那一份回应，其余丢弃
// 不合并、不去重：多份回应之间必然重叠，合并只会制造重复条目。
function finishHistory(idx) {
	const rd = roomsData[idx];
	if (!rd || !rd.history) return;
	if (rd.history.timer) {
		clearTimeout(rd.history.timer)
	}
	const responses = rd.history.responses;
	rd.history = null;
	let best = [];
	for (const entries of responses) {
		if (entries.length > best.length) {
			best = entries
		}
	}
	// 合并进本设备的记录，而不是只画一遍。
	// 只画不记的话，这台设备转手就提供不了这段历史：一旦长寿的设备退出，
	// 后来者再也同步不到更早的消息，历史会在内存里断链。
	// 去重键刻意不含 timestamp——同一条消息在各设备上存的是各自收到的时刻，
	// 时间戳必然不同，拿它当键等于没去重。
	const keyOf = (m) => {
		// 自己发的消息在本地记作 type 'me'，在别人的记录里是 'other' + 自己的名字；
		// 不做这一步归一，同一句话会被当成两条，自己的消息显示两遍。
		const isMine = m.type === 'me';
		const kind = isMine ? 'other' : m.type;
		const who = isMine ? (rd.myUserName || '') : (m.userName || '');
		const body = typeof m.text === 'string' ? m.text : JSON.stringify(m.text);
		return `${kind}|${who}|${m.msgType || ''}|${body}`
	};
	const seen = new Set();
	const merged = [];
	// 本地条目优先入列：自己发出的消息因此保持 'me' 类型，气泡样式与对齐才对
	for (const m of (rd.messages || [])) {
		const k = keyOf(m);
		if (seen.has(k)) continue;
		seen.add(k);
		merged.push(m)
	}
	for (const entry of best) {
		const k = keyOf(entry);
		if (seen.has(k)) continue;
		seen.add(k);
		merged.push(entry)
	}
	// 按各自记录的时间排序，让历史排在实时消息之前
	merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
	rd.messages = merged;

	if (best.length === 0) {
		// 谁都没有历史：只在当前房间说一声，已有记录不动
		if (activeRoomIndex === idx) {
			addSystemMsg(t('system.history_none', 'No history to sync'), true, Date.now())
		}
		return
	}
	// 整块重绘：renderChatArea 按 rd.messages 全量画一遍，不必逐条调用，
	// 也就不会留下局部重绘造成的重复气泡
	if (activeRoomIndex === idx) {
		renderChatArea()
	}
}

// Toggle private chat with a user
// 切换与某用户的私聊
export function togglePrivateChat(targetId, targetName) {
	const rd = roomsData[activeRoomIndex];
	if (!rd) return;
	if (rd.privateChatTargetId === targetId) {
		rd.privateChatTargetId = null;
		rd.privateChatTargetName = null
	} else {
		rd.privateChatTargetId = targetId;
		rd.privateChatTargetName = targetName
	}
	renderUserList();
	updateChatInputStyle()
}


// Exit the current room
// 退出当前房间
export function exitRoom() {
	if (activeRoomIndex >= 0 && roomsData[activeRoomIndex]) {
		const chatInst = roomsData[activeRoomIndex].chat;
		if (chatInst && typeof chatInst.destruct === 'function') {
			chatInst.destruct()
		} else if (chatInst && typeof chatInst.disconnect === 'function') {
			chatInst.disconnect()
		}
		roomsData[activeRoomIndex].chat = null;
		roomsData.splice(activeRoomIndex, 1);
		if (roomsData.length > 0) {
			switchRoom(0);
			return true
		} else {
			return false
		}
	}
	return false
}

export { roomsData, activeRoomIndex };

// Listen for sidebar username update event
// 监听侧边栏用户名更新事件
window.addEventListener('updateSidebarUsername', () => {
	if (activeRoomIndex >= 0 && roomsData[activeRoomIndex]) {
		const rd = roomsData[activeRoomIndex];
		const sidebarUsername = document.getElementById('sidebar-username');
		if (sidebarUsername && rd.myUserName) {
			sidebarUsername.textContent = rd.myUserName;
		}
		// Also update the avatar to ensure consistency
		if (rd.myUserName) {
			setSidebarAvatar(rd.myUserName);
		}
	}
});