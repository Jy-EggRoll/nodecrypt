// UI logic for NodeCrypt web client
// NodeCrypt 网页客户端的 UI 逻辑

import {
	createAvatarSVG
} from './util.avatar.js';
import {
	roomsData,
	activeRoomIndex,
	togglePrivateChat,
	exitRoom
} from './room.js';
import {
	escapeHTML
} from './util.string.js';
import {
	$id
} from './util.dom.js';
import {
	copyText
} from './util.clipboard.js';
import {
	closeSettingsPanel
} from './util.settings.js';
import {
	t
} from './util.i18n.js';
import {
	updateChatInputStyle
} from './chat.js';
import {
	generateRoomSecret,
	normalizeRoomSecret,
	SECRET_MAX_LENGTH
} from './util.roomkey.js';

// Utility functions for error handling
// 错误处理工具函数

// 房间密钥的生成与规整统一放在 util.roomkey.js，那里同时负责派生出交给服务器的
// 房间标识，生成规则与派生规则不能分散在两处。

// Device identity: remembered so an already approved device can reconnect
// without asking the room to approve it again on every refresh
// 设备身份：长期保存在本机，已获批准的设备重连时不必重新申请批准
const DEVICE_ID_STORAGE = 'nodecrypt_device_id';

// 房间码缓存沿用历史键名，老用户的缓存不必失效。
// 与设备标识一样必须包 try/catch：隐私模式下 localStorage 一旦抛错，
// 没有兜住就会让整张登录表单连带挂掉，代价远大于少记一个码。
const ROOM_CODE_STORAGE = 'nodecrypt_room_code';

export function rememberRoomCode(code) {
	try {
		if (code) localStorage.setItem(ROOM_CODE_STORAGE, code);
	} catch (error) {
		console.warn('Failed to remember room code:', error);
	}
}

export function getRememberedRoomCode() {
	try {
		return localStorage.getItem(ROOM_CODE_STORAGE) || '';
	} catch (error) {
		return '';
	}
}

export function getDeviceId() {
	let deviceId = '';
	try {
		deviceId = localStorage.getItem(DEVICE_ID_STORAGE) || '';
	} catch (error) {
		deviceId = '';
	}
	// 只接受 32 位十六进制，避免被改写过的值传到服务端
	if (/^[0-9a-f]{32}$/.test(deviceId)) {
		return deviceId;
	}
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	deviceId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	try {
		localStorage.setItem(DEVICE_ID_STORAGE, deviceId);
	} catch (error) {
		console.warn('Failed to remember device id:', error);
	}
	return deviceId;
}

// Validate room data
// 验证房间数据
function validateRoomData(roomData) {
	if (!roomData) {
		return { valid: false, error: 'No room data available' };
	}
	if (!roomData.roomName || roomData.roomName.trim() === '') {
		return { valid: false, error: 'Room name is required' };
	}
	return { valid: true };
}

// Copy text to clipboard with fallback
// 复制文本到剪贴板（含降级处理）
// 复制实现已收敛到 util.clipboard.js，这里只负责把结果反馈成系统消息
// （旧实现自带一份 prompt 弹窗降级，两套复制逻辑并存，现在只留一份）
function copyToClipboard(text, successMessage, errorPrefix) {
	if (!text) return;
	copyText(text).then((ok) => {
		window.addSystemMsg && window.addSystemMsg(ok ? successMessage : errorPrefix);
	});
}

// Execute menu action with error handling
// 执行菜单操作并处理错误
function executeMenuAction(action, closeMenuCallback) {
	try {
		switch (action) {
			case 'share':
				handleShareAction();
				break;
			case 'exit':
				handleExitAction();
				break;
			default:
				console.warn('Unknown menu action:', action);
		}
	} catch (error) {
		console.error('Menu action failed:', error);
		window.addSystemMsg && window.addSystemMsg(t('action.action_failed', 'Action failed. Please try again.'));
	} finally {
		closeMenuCallback && closeMenuCallback();
	}
}

// Handle share action
// 处理分享操作
function handleShareAction() {
	const validation = validateRoomData(roomsData[activeRoomIndex]);
	if (!validation.valid) {
		window.addSystemMsg && window.addSystemMsg(`${t('action.cannot_share', 'Cannot share:')} ${validation.error}`);
		return;
	}

	const rd = roomsData[activeRoomIndex];
	// 分享链接用最短形式：域名 + 片段里的房间密钥，不再编码房间名
	const code = normalizeRoomSecret(rd.roomName);
	if (!code) {
		window.addSystemMsg && window.addSystemMsg(t('action.cannot_share', 'Cannot share:') + ' ' + t('ui.node_name', 'Room Code'));
		return;
	}

	// 密钥必须放在片段里：片段不会随任何请求发给服务器，
	// 放进路径或查询串则服务器（以及它的日志）都能看到它。
	const url = `${location.origin}/#${code}`;
	
	// 降级路径不再弹 prompt，失败时把链接拼进提示里，用户仍能手动选中
	copyToClipboard(url, t('action.share_copied', 'Share link copied!'), t('action.copy_url_failed', 'Copy failed, url:') + ' ' + url);
}

// Handle exit action
// 处理退出操作
function handleExitAction() {
	try {
		const result = exitRoom();
		if (!result) {
			location.reload();
		}
	} catch (error) {
		console.error('Exit room failed:', error);
		// Force reload as fallback
		location.reload();
	}
}

// Render the main header
// 渲染主标题栏
export function renderMainHeader() {
	const rd = roomsData[activeRoomIndex];
	let roomName = rd ? rd.roomName : 'Room';
	let onlineCount = rd && rd.userList ? rd.userList.length : 0;
	if (rd && !rd.userList.some(u => u.clientId === rd.myId)) {
		onlineCount += 1
	}
	const safeRoomName = escapeHTML(roomName);
	$id("main-header").innerHTML = `<button class="mobile-menu-btn"id="mobile-menu-btn"aria-label="Open Sidebar"><svg width="35px"height="35px"viewBox="0 0 24 24"fill="none"xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier"stroke-width="0"></g><g id="SVGRepo_tracerCarrier"stroke-linecap="round"stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path fill-rule="evenodd"clip-rule="evenodd"d="M21.4498 10.275L11.9998 3.1875L2.5498 10.275L2.9998 11.625H3.7498V20.25H20.2498V11.625H20.9998L21.4498 10.275ZM5.2498 18.75V10.125L11.9998 5.0625L18.7498 10.125V18.75H14.9999V14.3333L14.2499 13.5833H9.74988L8.99988 14.3333V18.75H5.2498ZM10.4999 18.75H13.4999V15.0833H10.4999V18.75Z"fill="#808080"></path></g></svg></button><div class="main-header-center"id="main-header-center"><div class="main-header-flex"><div class="group-title group-title-bold">#${safeRoomName}</div><span class="main-header-members">${onlineCount} ${t('ui.members', 'members')}</span></div></div><div class="main-header-actions"><button class="more-btn"id="more-btn"aria-label="More Options"><svg width="35px"height="35px"viewBox="0 0 24 24"fill="none"xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier"stroke-width="0"></g><g id="SVGRepo_tracerCarrier"stroke-linecap="round"stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><circle cx="12"cy="6"r="1.5"fill="#808080"></circle><circle cx="12"cy="12"r="1.5"fill="#808080"></circle><circle cx="12"cy="18"r="1.5"fill="#808080"></circle></g></svg></button><button class="mobile-info-btn"id="mobile-info-btn"aria-label="Open Members"><svg width="35px"height="35px"viewBox="0 0 24 24"fill="none"xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier"stroke-width="0"></g><g id="SVGRepo_tracerCarrier"stroke-linecap="round"stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path fill-rule="evenodd"clip-rule="evenodd"d="M16.0603 18.307C14.89 19.0619 13.4962 19.5 12 19.5C10.5038 19.5 9.10996 19.0619 7.93972 18.307C8.66519 16.7938 10.2115 15.75 12 15.75C13.7886 15.75 15.3349 16.794 16.0603 18.307ZM17.2545 17.3516C16.2326 15.5027 14.2632 14.25 12 14.25C9.73663 14.25 7.76733 15.5029 6.74545 17.3516C5.3596 15.9907 4.5 14.0958 4.5 12C4.5 7.85786 7.85786 4.5 12 4.5C16.1421 4.5 19.5 7.85786 19.5 12C19.5 14.0958 18.6404 15.9908 17.2545 17.3516ZM21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12ZM12 12C13.2426 12 14.25 10.9926 14.25 9.75C14.25 8.50736 13.2426 7.5 12 7.5C10.7574 7.5 9.75 8.50736 9.75 9.75C9.75 10.9926 10.7574 12 12 12ZM12 13.5C14.0711 13.5 15.75 11.8211 15.75 9.75C15.75 7.67893 14.0711 6 12 6C9.92893 6 8.25 7.67893 8.25 9.75C8.25 11.8211 9.92893 13.5 12 13.5Z"fill="#808080"></path></g></svg></button><div class="more-menu"id="more-menu"><div class="more-menu-item"data-action="share">${t('action.share', 'Share')}</div><div class="more-menu-item"data-action="exit">${t('action.exit', 'Quit')}</div></div></div>`;
	setupMoreBtnMenu();
	setupMobileUIHandlers()
}

// Setup mobile UI event handlers
// 设置移动端 UI 事件处理
export function setupMobileUIHandlers() {
	const sidebar = document.getElementById('sidebar');
	const rightbar = document.getElementById('rightbar');
	const settingsSidebar = document.getElementById('settings-sidebar');
	const mobileMenuBtn = document.getElementById('mobile-menu-btn');
	const mobileInfoBtn = document.getElementById('mobile-info-btn');
	const sidebarMask = document.getElementById('mobile-sidebar-mask');
	const rightbarMask = document.getElementById('mobile-rightbar-mask');

	function isMobile() {
		return window.innerWidth <= 768
	}

	function updateMobileBtnDisplay() {
		if (isMobile()) {
			if (mobileMenuBtn) mobileMenuBtn.style.display = 'flex';
			if (mobileInfoBtn) mobileInfoBtn.style.display = 'flex'
		} else {
			if (mobileMenuBtn) mobileMenuBtn.style.display = 'none';
			if (mobileInfoBtn) mobileInfoBtn.style.display = 'none';
			if (sidebar) sidebar.classList.remove('mobile-open');
			if (rightbar) rightbar.classList.remove('mobile-open');
			if (sidebarMask) sidebarMask.classList.remove('active');
			if (rightbarMask) rightbarMask.classList.remove('active')
		}
	}
	updateMobileBtnDisplay();
	window.addEventListener('resize', updateMobileBtnDisplay);
	if (mobileMenuBtn && sidebar && sidebarMask) {
		mobileMenuBtn.onclick = function(e) {
			e.stopPropagation();
			sidebar.classList.add('mobile-open');
			sidebarMask.classList.add('active')
		};		sidebarMask.onclick = function() {
			// Check if settings sidebar is open
			if (settingsSidebar && settingsSidebar.classList.contains('mobile-open')) {
				closeSettingsPanel();
			} else {
				sidebar.classList.remove('mobile-open');
				sidebarMask.classList.remove('active');
			}
		}
	}
	if (mobileInfoBtn && rightbar && rightbarMask) {
		mobileInfoBtn.onclick = function(e) {
			e.stopPropagation();
			rightbar.classList.add('mobile-open');
			rightbarMask.classList.add('active')
		};
		rightbarMask.onclick = function() {
			rightbar.classList.remove('mobile-open');
			rightbarMask.classList.remove('active')
		}
	}	// Consolidated click event listener for closing sidebars
	document.addEventListener('click', function(ev) {
		const settingsBtn = $id('settings-btn');
		const isSettingsButtonClick = settingsBtn && settingsBtn.contains(ev.target);
		const isSettingsBackButtonClick = $id('settings-back-btn') && $id('settings-back-btn').contains(ev.target);

		// Close settings sidebar if open and click is outside (and not on the open button or back button)
		if (settingsSidebar && (settingsSidebar.classList.contains('open') || settingsSidebar.classList.contains('mobile-open'))) {
			if (!settingsSidebar.contains(ev.target) && !isSettingsButtonClick && !isSettingsBackButtonClick) {
				closeSettingsPanel();
			}
		}

		if (isMobile()) {
			// Mobile-specific logic
			if (sidebar && sidebar.classList.contains('mobile-open')) {
				if (!sidebar.contains(ev.target) && ev.target !== mobileMenuBtn) {
					sidebar.classList.remove('mobile-open');
					if (sidebarMask) sidebarMask.classList.remove('active');
				}
			}
			if (settingsSidebar && settingsSidebar.classList.contains('mobile-open')) {
				// 检查点击目标是否为设置按钮本身
				const isSettingsButton = settingsBtn && settingsBtn.contains(ev.target);
				if (!settingsSidebar.contains(ev.target) && !isSettingsButton) {
					closeSettingsPanel();
				}
			}
			if (rightbar && rightbar.classList.contains('mobile-open')) {
				if (!rightbar.contains(ev.target) && ev.target !== mobileInfoBtn) {
					rightbar.classList.remove('mobile-open');
					if (rightbarMask) rightbarMask.classList.remove('active');
				}
			}
		} else {
			// Desktop-specific logic
			// 如果设置侧边栏打开，并且点击位置在侧边栏外部且不是设置按钮本身
			if (settingsSidebar && settingsSidebar.classList.contains('open')) {
				const isSettingsButton = settingsBtn && settingsBtn.contains(ev.target);
				if (!settingsSidebar.contains(ev.target) && !isSettingsButton) {
					closeSettingsPanel();
				}
			}
		}
	})
}

// Render the user/member list
// 渲染用户/成员列表
export function renderUserList(updateHeader = false) {
	const userListEl = $id('member-list');
	if (!userListEl) return;
	userListEl.innerHTML = '';
	const rd = roomsData[activeRoomIndex];
	if (!rd) return;
	const me = rd.userList.find(u => u.clientId === rd.myId);
	const others = rd.userList.filter(u => u.clientId !== rd.myId);
	// 新增：如有其他成员，顶部插入简洁提示
	if (others.length > 0) {
		const tip = document.createElement('div');
		tip.className = 'member-tip member-tip-center';
		tip.textContent = t('ui.start_private_chat', '选择用户开始私信');
		userListEl.appendChild(tip);
	}
	if (me) userListEl.appendChild(createUserItem(me, true));
	others.forEach(u => userListEl.appendChild(createUserItem(u, false)));
	if (updateHeader) {
		renderMainHeader()
	}
}

// Create a user list item
// 创建一个用户列表项
export function createUserItem(user, isMe) {
	const div = document.createElement('div');
	const rd = roomsData[activeRoomIndex];
	const isPrivateTarget = rd && user.clientId === rd.privateChatTargetId;
	div.className = 'member' + (isMe ? ' me' : '') + (isPrivateTarget ? ' private-chat-active' : '');
	const rawName = user.userName || user.username || user.name || '';
	const safeUserName = escapeHTML(rawName);
	div.innerHTML = `<span class="avatar"></span><div class="member-info"><div class="member-name">${safeUserName}${isMe?t('ui.me', ' (me)'):''}</div></div>`;
	const avatarEl = div.querySelector('.avatar');
	if (avatarEl) {
		const svg = createAvatarSVG(rawName);
		const cleanSvg = svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		avatarEl.innerHTML = cleanSvg
	}
	if (!isMe) {
		div.onclick = () => togglePrivateChat(user.clientId, safeUserName)
	}
	return div
}

// Setup the 'more' button menu
// 设置"更多"按钮菜单
export function setupMoreBtnMenu() {
	const btn = $id('more-btn');
	const menu = $id('more-menu');
	if (!btn || !menu) return;
	let animating = false;

	// Open the menu
	// 打开菜单
	function openMenu() {
		menu.style.display = 'block';
		menu.classList.remove('close');
		// 强制触发重绘，然后添加打开动画
		menu.offsetHeight; // 强制重绘
		menu.classList.add('open');
	}

	// Close the menu
	// 关闭菜单
	function closeMenu() {
		if (animating) return;
		animating = true;
		menu.classList.remove('open');
		menu.classList.add('close');
		setTimeout(() => {
			if (menu.classList.contains('close')) menu.style.display = 'none';
			animating = false;
		}, 300);
	}

	btn.onclick = function(e) {
		e.stopPropagation();
		if (menu.classList.contains('open')) {
			closeMenu();
		} else {
			openMenu();
		}
	};

	menu.onclick = function(e) {
		if (e.target.classList.contains('more-menu-item')) {
			const action = e.target.dataset.action;
			executeMenuAction(action, closeMenu);
		}
	};

	document.addEventListener('click', function hideMenu(ev) {
		if (!menu.contains(ev.target) && ev.target !== btn) {
			closeMenu();
		}
	});

	menu.addEventListener('animationend', function(e) {
		animating = false;
	});

	menu.addEventListener('transitionend', function(e) {
		animating = false;
	});
}

// Prevent space and special character input
// 禁止输入空格和特殊字符
export function preventSpaceInput(input) {
	if (!input) return;
	input.addEventListener('keydown', function(e) {
		if (e.key === ' ' || (/[\u0000-\u007f]/.test(e.key) && /[\p{P}\p{S}]/u.test(e.key) && e.key !== "'")) {
			e.preventDefault()
		}
	});
	input.addEventListener('input', function(e) {
		input.value = input.value.replace(/[\s\p{P}\p{S}]/gu, function(match) {
			return match === "'" ? "'" : ''
		})
	})
}

// Login form submit handler
// 登录表单提交处理函数
export function loginFormHandler(modal) {
	return function(e) {
		e.preventDefault();
		let userName, roomName, btn, roomInput, warnTip;
		if (modal) {
			userName = document.getElementById('userName-modal').value.trim();
			roomName = normalizeRoomSecret(document.getElementById('roomName-modal').value);
			document.getElementById('roomName-modal').value = roomName;
			btn = modal.querySelector('.login-btn');
			roomInput = document.getElementById('roomName-modal')
		} else {
			userName = document.getElementById('userName').value.trim();
			roomName = normalizeRoomSecret(document.getElementById('roomName').value);
			document.getElementById('roomName').value = roomName;
			btn = document.querySelector('#login-form .login-btn');
			roomInput = document.getElementById('roomName')
		}
		const exists = roomsData.some(rd => rd.roomName && rd.roomName.toLowerCase() === roomName.toLowerCase());
		if (roomInput) {
			roomInput.style.border = '';
			roomInput.style.background = '';
			if (roomInput._warnTip) {
				roomInput.parentNode.removeChild(roomInput._warnTip);
				roomInput._warnTip = null
			}
		}
		if (exists) {
			if (roomInput) {
				roomInput.style.border = '1.5px solid #e74c3c';
				roomInput.style.background = '#fff6f6';
				warnTip = document.createElement('div');
				warnTip.style.color = '#e74c3c';
				warnTip.style.fontSize = '13px';
				warnTip.style.marginTop = '4px';
				warnTip.textContent = t('ui.node_exists', 'Room already exists');
				roomInput.parentNode.appendChild(warnTip);
				roomInput._warnTip = warnTip;
				roomInput.focus()
			}			if (btn) {
				btn.disabled = false;
				btn.innerText = t('ui.enter', 'ENTER')
			}
			return
		}		if (btn) {
			btn.disabled = true;
			btn.innerText = t('ui.connecting', 'Connecting...')
		}
		window.joinRoom(userName, roomName, modal, function(success) {
			if (success) {
				// 进入房间成功才写缓存：这一次才是真的「用过」这个码。写早了会把
				// 连不上的码留在缓存里，下次打开就被预填进去；主表单与侧边栏弹窗
				// 都算真的进了房间，所以两条路径都写。
				rememberRoomCode(roomName);
				// 用户可能在输入框里改成了另一个密钥，成功后必须把地址栏同步过去，
				// 否则刷新时片段里的旧密钥优先，会把人莫名拉回旧房间。
				// 侧边栏加入的第二个房间不改网址，它只是同一个标签页里的额外房间。
				if (!modal) {
					window.history.replaceState({}, '', '/#' + roomName);
				}
			} else if (btn) {
				btn.disabled = false;
				btn.innerText = 'ENTER'
			}
		})
	}
}

// 生成登录表单HTML
// Generate login form HTML

// 主表单与侧边栏弹窗共用这一份「换一个」实现：同一个生成规则、同一次写入缓存。
// 两处各写一遍的话，生成规则或缓存时机迟早会改漏其中一处。
// 目标输入框从按钮所在的输入框组里取，避免再给按钮挂一个 id 或 data 属性。
function regenerateRoomCode(button) {
	const input = button.closest('.input-group')?.querySelector('input');
	if (!input) return;
	const code = generateRoomSecret();
	input.value = code;
	// 用户主动换掉的码就是他选中的码，立刻落盘，刷新后仍是这一个
	rememberRoomCode(code);
	// 主表单的地址栏片段必须跟着换成新码：片段优先于缓存，只写缓存不改地址栏的话，
	// 用户点完「换一个」再刷新，回来的还是地址栏里那个旧码，换码等于白换。
	if (input.id === 'roomName') {
		window.history.replaceState({}, '', '/#' + code);
	}
}

// 两个表单都是运行时插入并销毁的，用事件委托只绑一次，
// 比在每处插入后各绑一次更不容易漏掉将来新增的第三个入口。
document.addEventListener('click', (event) => {
	const button = event.target.closest('.room-code-refresh');
	if (button) regenerateRoomCode(button);
});

// 按钮只有图形，可读文案来自语言表。主表单会被 regenerateLoginForm 重新渲染成
// 新语言，侧边栏弹窗不会，所以在语言变更时统一刷一遍 title 与 aria-label。
function refreshRoomCodeButtonLabels() {
	const label = t('ui.room_code_regenerate', 'Generate another room code');
	document.querySelectorAll('.room-code-refresh').forEach((button) => {
		button.title = label;
		button.setAttribute('aria-label', label);
	});
}
export function generateLoginForm(isModal = false) {
	const idSuffix = isModal ? '-modal' : '';
	return `		<div class="input-group">
			<input id="userName${idSuffix}" type="text" autocomplete="username" required minlength="1" maxlength="15" placeholder="">
			<label for="userName${idSuffix}" class="floating-label">${t('ui.username', 'Username')}</label>
		</div>
		<div class="input-group input-group-room">
			<input id="roomName${idSuffix}" type="text" required minlength="1" maxlength="${SECRET_MAX_LENGTH}" pattern="[a-z0-9]+" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="">
			<label for="roomName${idSuffix}" class="floating-label">${t('ui.node_name', 'Room Code')}</label>
			<button type="button" class="room-code-refresh" title="${t('ui.room_code_regenerate', 'Generate another room code')}" aria-label="${t('ui.room_code_regenerate', 'Generate another room code')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16"/><path d="M3 21v-5h5"/></svg></button>
		</div>
		<button type="submit" class="login-btn">${t('ui.enter', 'ENTER')}</button>
	`;
}
export function openLoginModal() {
	const modal = document.createElement('div');
	modal.className = 'login-modal';
	modal.innerHTML = `<div class="login-modal-bg"></div><div class="login-modal-card"><button class="login-modal-close login-modal-close-abs">&times;</button><h1>${t('ui.enter_node', 'Enter a Room')}</h1><form id="login-form-modal">${generateLoginForm(true)}</form></div>`;
	document.body.appendChild(modal);
	modal.querySelector('.login-modal-close').onclick = () => modal.remove();
	preventSpaceInput(modal.querySelector('#userName-modal'));
	preventSpaceInput(modal.querySelector('#roomName-modal'));
	const form = modal.querySelector('#login-form-modal');
	form.addEventListener('submit', loginFormHandler(modal));
	autofillRoomPwd('-modal')
}

// Show the waiting room while the server is holding the join request
// 显示等待界面，等待房间内设备批准
export function showWaitingRoom(deviceName) {
	hideWaitingRoom();
	const waitingRoom = $id('waiting-room');
	if (!waitingRoom) return;
	const nameEl = waitingRoom.querySelector('#waiting-room-device');
	if (nameEl) nameEl.textContent = deviceName || '';
	const loginContainer = $id('login-container');
	if (loginContainer) loginContainer.style.display = 'none';
	waitingRoom.style.display = 'flex';
}

// Hide the waiting room; the caller decides which layer comes back
// 隐藏等待界面，回到哪一层由调用方决定
export function hideWaitingRoom() {
	const waitingRoom = $id('waiting-room');
	if (waitingRoom) waitingRoom.style.display = 'none';
}

// Ask the current user to approve or deny a client that wants to join
// 让当前用户决定是否让申请者加入房间
export function showJoinApproval(chat, name, clientId) {
	if (!chat || !clientId) return;
	// 同一时刻可能有多个申请者，因此用 class 加 data-client-id 定位，
	// 不能用固定 id，否则多个弹窗会互相顶掉选择器
	const existing = document.querySelector('.join-request-modal[data-client-id="' + CSS.escape(clientId) + '"]');
	if (existing) return;
	const modal = document.createElement('div');
	modal.className = 'login-modal join-request-modal';
	modal.dataset.clientId = clientId;
	const unknownName = t('ui.anonymous', 'Anonymous');
	modal.innerHTML = `<div class="login-modal-bg"></div><div class="login-modal-card"><h1>${t('ui.join_request_title', 'Join Request')}</h1><p class="join-request-name">${escapeHTML(name || unknownName)} ${t('ui.join_request_desc', 'wants to join this room')}</p><div class="join-request-actions"><button class="login-btn join-approve-btn">${t('ui.approve', 'Approve')}</button><button class="login-btn-secondary join-deny-btn">${t('ui.deny', 'Deny')}</button></div></div>`;
	document.body.appendChild(modal);
	// 多个申请者会同时产生多个弹窗，每个都自带一层遮罩。层级相同的话，
	// 上层遮罩会压住下层弹窗的按钮，用户点不到；按弹窗数量递增，后出现的在上。
	modal.style.zIndex = String(10000 + document.querySelectorAll('.join-request-modal').length);
	const close = () => modal.remove();
	modal.querySelector('.join-approve-btn').onclick = () => {
		chat.approveJoin(clientId);
		close();
	};
	modal.querySelector('.join-deny-btn').onclick = () => {
		chat.denyJoin(clientId);
		close();
	};
}

// Close the approval dialog of a join request that no longer exists
// 关闭已失效的候客申请对应的批准弹窗
export function hideJoinApproval(clientId) {
	if (!clientId) return;
	const modal = document.querySelector('.join-request-modal[data-client-id="' + CSS.escape(clientId) + '"]');
	if (modal) modal.remove();
}

// Setup member list tabs
export function setupTabs() {
	const tabs = document.getElementById("member-tabs").children;
	for (let i = 0; i < tabs.length; i++) {
		tabs[i].onclick = function() {
			for (let j = 0; j < tabs.length; j++) tabs[j].classList.remove("active");
			this.classList.add("active")
		}
	}
}

// Autofill room from URL
// 从 URL 自动填充房间
// 两个表单的输入框 id 靠后缀区分：主表单是 roomName，弹窗是 roomName-modal
export function autofillRoomPwd(idSuffix = '') {
	// 只有主登录表单会预填「上次用过的码」并改写地址栏；侧边栏的「加入房间」弹窗
	// 只给一个新生成的码：那里多半是要另外新建一个房间，预填缓存里的码会让人以为
	// 自己走错了地方，而完全留空又得让用户先想一个码出来。
	const isMainForm = idSuffix === '';
	const roomInput = document.getElementById('roomName' + idSuffix);
	// 密钥只从网址片段读取：片段不随任何请求发给服务器，路径与查询串会。
	// 曾经放在路径或查询串里的旧链接不再兼容，读不到片段就等于没有密钥。
	const hashSecret = normalizeRoomSecret(decodeURIComponent(window.location.hash.replace(/^#/, '')));

	// 预填优先级：网址片段 → 上一次真正用过的码 → 新生成一个。
	// 片段必须压过缓存：别人发来的链接要能直接进到对方那个房间；若让缓存优先，
	// 点开链接的人会被拉回自己上次的房间，还以为链接坏了。
	// 新生成的那个码刻意不写进缓存：它还没被「使用」过，而刷新有地址栏片段兜底
	// （片段里的码优先于缓存），只有真正进入房间成功、或用户主动点「换一个」才落盘；
	// 否则缓存里会留下一个用户从未用过的码，反而把上次真正用过的那个顶掉。
	let roomValue = '';
	if (isMainForm) {
		roomValue = hashSecret || normalizeRoomSecret(getRememberedRoomCode()) || generateRoomSecret();
	} else {
		// 弹窗每次都现生成一个：复用缓存里的码只会让人分不清自己是在新建还是加入
		roomValue = generateRoomSecret();
	}

	// Fill in the form fields
	if (roomValue && roomInput) {
		roomInput.value = roomValue;
		// 输入框保持可编辑：用户要换别的密钥时，点旁边的「换一个」或直接改都行
		roomInput.readOnly = false;
	}

	// 地址栏收敛成片段形式，且只保留片段：路径与查询串都会随请求发给服务器。
	if (isMainForm && roomValue) {
		const canonical = '/#' + roomValue;
		if (window.location.pathname + window.location.hash !== canonical || window.location.search !== '') {
			window.history.replaceState({}, '', canonical);
		}
	}
}

// 初始化登录表单
// Initialize login form
export function initLoginForm() {
	const loginFormContainer = document.getElementById('login-form');
	if (loginFormContainer && loginFormContainer.children.length === 0) {
		// 只有当登录表单为空时才初始化
		// Only initialize if login form is empty
		loginFormContainer.innerHTML = generateLoginForm(false);
	}

	// 房间码输入框只接受小写字母与数字，避免用户输入大写后与已有房间码不一致
	const roomCodeInput = document.getElementById('roomName');
	if (roomCodeInput && !roomCodeInput._codeBound) {
		roomCodeInput._codeBound = true;
		roomCodeInput.addEventListener('input', () => {
			const cleaned = normalizeRoomSecret(roomCodeInput.value);
			if (cleaned !== roomCodeInput.value) roomCodeInput.value = cleaned;
		});
	}

	// 为登录页面添加class，用于手机适配
	// Add class to login page for mobile adaptation
	document.body.classList.add('login-page');
}

// Listen for language change events to refresh UI
// 监听语言变更事件刷新UI
window.addEventListener('languageChange', () => {
	// Refresh main header and user list
	renderMainHeader();
	renderUserList(false);
	
	// Refresh chat input placeholder
	updateChatInputStyle();

	// 房间码行的图标按钮只有图形，提示文字来自语言表，跟着语言一起刷新
	refreshRoomCodeButtonLabels();
});

// Listen for regenerate login form event
// 监听重新生成登录表单事件
window.addEventListener('regenerateLoginForm', () => {
	const loginFormContainer = document.getElementById('login-form');
	if (loginFormContainer) {
		loginFormContainer.innerHTML = generateLoginForm(false);
	}
});

// 初始化翻转卡片功能
// Initialize flip card functionality
export function initFlipCard() {
	const flipCard = document.getElementById('flip-card');
	const helpBtn = document.getElementById('help-btn');
	const backBtn = document.getElementById('back-btn');
	
	if (!flipCard || !helpBtn || !backBtn) return;
	
	const flipCardInner = flipCard.querySelector('.flip-card-inner');
	if (!flipCardInner) return;
	
	// 翻转状态
	let isFlipped = false;
	
	// 简单的翻转函数
	function toggleFlip() {
		isFlipped = !isFlipped;
		if (isFlipped) {
			flipCardInner.classList.add('flipped');
		} else {
			flipCardInner.classList.remove('flipped');
		}
	}
	
	// 帮助按钮点击事件
	helpBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		toggleFlip();
	});
	
	// 返回按钮点击事件
	backBtn.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		toggleFlip();
	});
}
