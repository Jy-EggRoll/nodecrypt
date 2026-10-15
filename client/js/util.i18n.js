// Simple i18n utility for NodeCrypt
// NodeCrypt 简单国际化工具

// Language definitions
// 语言定义
const LANGUAGES = {
	en: {
		code: 'en',
		name: 'English',
		flag: '🇺🇸',
		translations: {
			// Meta tags for SEO
			'meta.description': 'NodeCrypt - True end-to-end encrypted chat system, no database, all messages encrypted locally, server only relays encrypted data, supports Cloudflare Workers, Docker, self-hosting and local development.',
			'meta.keywords': 'end-to-end encryption, security, chat, WebSocket, Cloudflare Workers, JavaScript, E2EE, anonymous communication, AES, ECDH, RSA, ChaCha20, security, open source, NodeCrypt, shuaiplus',
			'meta.og_title': 'NodeCrypt - End-to-End Encrypted Chat System',
			'meta.og_description': 'NodeCrypt is a zero-knowledge, end-to-end encrypted open source chat system where all encryption and decryption is done locally on the client side, and servers cannot access plaintext. Supports multi-platform deployment, secure, anonymous, no message history.',
			'meta.twitter_title': 'NodeCrypt - End-to-End Encrypted Chat System',
			'meta.twitter_description': 'NodeCrypt is a zero-knowledge, end-to-end encrypted open source chat system where all encryption and decryption is done locally on the client side, and servers cannot access plaintext.',
			
			// Login and main UI
			'ui.enter_node': 'Enter a Room',
			'ui.username': 'Username',
			'ui.node_name': 'Room Code',
			// Join approval and waiting screens share this wording
			// 加入批准与候客界面共用这些文案
			'ui.waiting_approval': 'Waiting for approval',
			'ui.waiting_hint': 'Approve this device on a device already in the room.',
			'ui.this_device': 'This device',
			'ui.join_request_title': 'Join Request',
			'ui.join_request_desc': 'wants to join this room',
			'ui.approve': 'Approve',
			'ui.deny': 'Deny',
			'ui.node_password': 'Room Password',
			'ui.optional': '(optional)',
			'ui.enter': 'ENTER',
			'ui.connecting': 'Connecting...',
			'ui.node_exists': 'Room already exists',
			'ui.my_name': 'My Name',
			'ui.members': 'Members',
			'ui.message': 'Message',
			'ui.private_message_to': 'Private Message to',
			'ui.me': ' (me)',
			'ui.anonymous': 'Anonymous',
			'ui.start_private_chat': 'Select for private chat',
			
			// Copy button on a text message (action.copied already exists above and is reused)
			// 文本消息上的复制按钮（成功文案复用上面已有的 action.copied，不另立一份）
			'action.copy': 'Copy message',
			'action.copy_failed_hint': 'Copy failed, select the text manually',
			
			// Settings panel
			'settings.title': 'Settings',
			'settings.notification': 'Notification Settings',
			'settings.theme': 'Theme Settings',
			'settings.language': 'Language Settings',
			'settings.desktop_notifications': 'Desktop Notifications',
			'settings.sound_notifications': 'Sound Notifications',
			'settings.language_switch': 'Language',
			'settings.chinese': 'Chinese',
			'settings.english': 'English',
			
			// File upload and transfer
			'file.selected_files': 'Selected Files',
			'file.clear_all': 'Clear All',
			'file.cancel': 'Cancel',
			'file.send_files': 'Send Files',			'file.sending': 'Sending',
			'file.receiving': 'Receiving',
			'file.files': 'files',
			'file.total': 'Total',
			'file.files_selected': '{count} files selected, {size} total',
			'file.upload_files': 'Upload Files',
			'file.attach_file': 'Attach file',
			// Inline preview of file messages
			// 文件消息的就地预览
			'preview.loading': 'Loading preview…',
			'preview.unavailable': 'Preview unavailable',
			'preview.unsupported': 'This browser cannot preview this file.',
			'preview.image_failed': 'This browser cannot display that image format.',
			'preview.audio_failed': 'This browser cannot play that audio format.',
			'preview.video_failed': 'This browser cannot play that video format.',
			'preview.text_failed': 'This file is not readable text, so it cannot be rendered.',
			'preview.download_view': 'Download to view',
			'file.no_password_required': 'No password required',
			'file.drag_drop': 'Drag and drop files here',
			'file.or': 'or',
			'file.browse_files': 'browse files',
			
			// Notifications and messages
			'notification.enabled': 'Notifications enabled',
			'notification.alert_here': 'You will receive alerts here.',
			'notification.not_supported': 'Notifications are not supported by your browser.',
			'notification.allow_browser': 'Please allow notifications in your browser settings.',
			'notification.image': '[image]',
			'notification.private': '(Private)',
			
			// Actions and menu
			'action.share': 'Share',
			'action.exit': 'Exit',
			'action.emoji': 'Emoji',
			'action.settings': 'Settings',
			'action.back': 'Back',
			'action.cancel': 'Cancel',
			'action.copied': 'Copied to clipboard!',
			'action.share_copied': 'Share link copied!',
			'action.copy_url_failed': 'Copy failed, url:',
			'action.action_failed': 'Action failed. Please try again.',
			'action.cannot_share': 'Cannot share:',
					// System messages
			'system.file_send_failed': 'Failed to send files:',
			'system.joined': 'joined the conversation',
			'system.left': 'left the conversation',
			'system.secured': 'connection secured',
			'system.private_message_failed': 'Cannot send private message to',
			'system.private_file_failed': 'Cannot send private file to',
			'system.user_not_connected': 'User might not be fully connected.',
			'system.join_denied': 'Your join request was denied',
			'system.history_syncing': 'Syncing history…',
			'system.history_none': 'No history to sync',
					// Help page
			'help.title': 'User Guide',
			'help.back_to_login': 'Back to Login',
			'help.usage_guide': 'User Guide',
			'help.what_is_nodecrypt': 'What is this',			'help.what_is_nodecrypt_desc': 'A page for sending messages and files between your own devices. Content is end-to-end encrypted and the relay stores nothing.',
			'help.how_to_start': 'How to start',
			'help.step_username': 'Enter a device name',
			'help.step_username_desc': 'The name other devices see, for example Living Room TV.',
			'help.step_node_name': 'Get a room code',
			'help.step_node_name_desc': 'Open the site root and a six-character code is generated; it shows up after the # in the address bar, like /#abc123.',
			'help.step_password': 'Open the same address elsewhere',
			'help.step_password_desc': 'Open the full address on the other device, including the part after #. Drop that part and you land in a different room. Then fill in its device name.',
			'help.step_join': 'Wait for approval',
			'help.step_join_desc': 'A device already in the room gets a dialog; you enter only after it approves.',
			'help.security_features': 'What you should know',			'help.e2e_encryption': 'End-to-end encrypted',
			'help.e2e_encryption_desc': 'The relay gets only a room ID derived from the room key. It never receives the key itself and cannot work out the message keys from what it has.',
			'help.password_enhanced_encryption': 'Approval instead of password',
			'help.password_enhanced_encryption_desc': 'There is no room password. A device already in the room approves each new device.',
			'help.no_history': 'Nothing is stored',
			'help.no_history_desc': 'The relay keeps nothing. Messages live only in the memory of devices currently in the room; while at least one stays open, a newly joined device can be brought up to date with recent text.',
			'help.anonymous_communication': 'No account',
			'help.anonymous_communication_desc': 'No registration and no personal information; only a device name you type yourself.',
			'help.decentralized': 'Runs on Cloudflare',
			'help.decentralized_desc': 'Deployed as a Cloudflare Worker; no server of your own to maintain.',			'help.usage_tips': 'Tips',
			'help.important_note': 'Please note',
			'help.room_isolation_note': 'Different room codes are entirely separate rooms and cannot see each other.',
			'help.tip_private_chat': 'Short address',
			'help.tip_private_chat_desc': 'The room code sits after the # in the address, like /#abc123.',
			'help.tip_group_chat': 'Several rooms at once',
			'help.tip_group_chat_desc': 'One tab can hold more than one room; they are listed in the sidebar.',
			'help.tip_security_reminder': 'Memory only',
			'help.tip_security_reminder_desc': 'Refreshing or closing the tab clears what this device holds.',
			'help.tip_password_strategy': 'One-time approval',
			'help.tip_password_strategy_desc': 'A device that has been approved does not need approval again for a while.',
		}
	},
	zh: {
		code: 'zh',
		name: '中文',
		flag: '🇨🇳',
		translations: {
			// Meta tags for SEO
			'meta.description': 'NodeCrypt - 真正的端到端加密聊天系统，无数据库，所有消息本地加密，服务器仅做加密数据中转，支持 Cloudflare Workers、Docker、自托管和本地开发。',
			'meta.keywords': '端到端加密, 安全, 聊天, WebSocket, Cloudflare Workers, JavaScript, E2EE, 匿名通信, AES, ECDH, RSA, ChaCha20, 安全, 开源, NodeCrypt, shuaiplus',
			'meta.og_title': 'NodeCrypt - 端到端加密聊天系统',
			'meta.og_description': 'NodeCrypt 是一个端到端加密的开源聊天系统，所有加密解密均在客户端本地完成，服务器无法获取明文。支持多平台部署，安全、匿名、无历史消息。',
			'meta.twitter_title': 'NodeCrypt - 端到端加密聊天系统',
			'meta.twitter_description': 'NodeCrypt 是一个端到端加密的开源聊天系统，所有加密解密均在客户端本地完成，服务器无法获取明文。',
			
			// Login and main UI
			'ui.enter_node': '进入新的房间',
			'ui.username': '用户名',
			'ui.node_name': '房间码',
			// 加入批准与候客界面共用这些文案
			// Join approval and waiting screens share this wording
			'ui.waiting_approval': '等待房间内设备批准',
			'ui.waiting_hint': '请在房间内已有的设备上批准这台设备。',
			'ui.this_device': '这台设备',
			'ui.join_request_title': '加入申请',
			'ui.join_request_desc': '请求加入房间',
			'ui.approve': '批准',
			'ui.deny': '拒绝',
			'ui.node_password': '房间密码',
			'ui.optional': '（可选）',
			'ui.enter': '确定',
			'ui.connecting': '连接中...',
			'ui.node_exists': '此房间已存在',
			'ui.my_name': '我的名字',
			'ui.members': '在线成员',
			'ui.message': '消息',
			'ui.private_message_to': '私信给',
			'ui.me': '（我）',
			'ui.anonymous': '匿名用户',
			'ui.start_private_chat': '选择用户开始私信',
			
			// Copy button on a text message (action.copied already exists above and is reused)
			// 文本消息上的复制按钮（成功文案复用上面已有的 action.copied，不另立一份）
			'action.copy': '复制这条消息',
			'action.copy_failed_hint': '复制失败，请手动选中文字复制',
			
			// Settings panel
			'settings.title': '设置',
			'settings.notification': '通知设置',
			'settings.theme': '主题设置',
			'settings.language': '语言设置',
			'settings.desktop_notifications': '桌面通知',
			'settings.sound_notifications': '声音通知',
			'settings.language_switch': '语言',
			'settings.chinese': '中文',
			'settings.english': 'English',
			
			// File upload and transfer
			'file.selected_files': '已选择的文件',
			'file.clear_all': '清空所有',
			'file.cancel': '取消',
			'file.send_files': '发送文件',			'file.sending': '发送中',
			'file.receiving': '接收中',
			'file.files': '个文件',
			'file.total': '总计',
			'file.files_selected': '选中 {count} 个文件，总计 {size}',
			'file.upload_files': '上传文件',
			'file.attach_file': '附加文件',
			// 文件消息的就地预览
			'preview.loading': '正在载入预览…',
			'preview.unavailable': '无法在线预览',
			'preview.unsupported': '这个浏览器无法预览该文件。',
			'preview.image_failed': '这个浏览器显示不了该图片格式。',
			'preview.audio_failed': '这个浏览器播放不了该音频格式。',
			'preview.video_failed': '这个浏览器播放不了该视频格式。',
			'preview.text_failed': '该文件不是可读的文本，无法渲染。',
			'preview.download_view': '下载后查看',
			'file.no_password_required': '无需密码',
			'file.drag_drop': '拖拽文件到此处',
			'file.or': '或',
			'file.browse_files': '浏览文件',
			
			// Notifications and messages
			'notification.enabled': '通知已启用',
			'notification.alert_here': '您将在此处收到通知。',
			'notification.not_supported': '您的浏览器不支持通知功能。',
			'notification.allow_browser': '请在浏览器设置中允许通知。',
			'notification.image': '[图片]',
			'notification.private': '（私信）',
			
			// Actions and menu
			'action.share': '分享',
			'action.exit': '退出',
			'action.emoji': '表情',
			'action.settings': '设置',
			'action.back': '返回',
			'action.cancel': '取消',
			'action.copied': '已复制到剪贴板！',
			'action.share_copied': '分享链接已复制！',
			'action.copy_url_failed': '复制失败，链接：',
			'action.action_failed': '操作失败，请重试。',
			'action.cannot_share': '无法分享：',
					// System messages
			'system.file_send_failed': '文件发送失败：',
			'system.joined': '加入了对话',
			'system.left': '离开了对话',
			'system.secured': '已建立端到端安全连接',
			'system.private_message_failed': '无法发送私信给',
			'system.private_file_failed': '无法发送私密文件给',
			'system.user_not_connected': '用户可能未完全连接。',
			'system.join_denied': '加入请求已被拒绝',
			'system.history_syncing': '正在同步历史消息…',
			'system.history_none': '没有可同步的历史消息',
			
			// Help page
			'help.title': '使用说明',
			'help.back_to_login': '返回登录',
			'help.usage_guide': '使用说明',
			'help.what_is_nodecrypt': '这是什么',			'help.what_is_nodecrypt_desc': '一个在你自己的设备之间传消息和文件的网页。内容端到端加密，中转端不保存任何东西。',
			'help.how_to_start': '怎么开始',
			'help.step_username': '填写设备名',
			'help.step_username_desc': '其他设备看到的名称，例如“客厅电视”。',
			'help.step_node_name': '取得房间码',
			'help.step_node_name_desc': '打开网站根地址会得到一个 6 位房间码，它会出现在地址栏的 # 之后，例如 /#abc123。',
			'help.step_password': '在另一台设备打开同一地址',
			'help.step_password_desc': '在另一台设备上打开完整地址，要把 # 后面的房间码一起带上，漏掉它会进到另一个房间；然后填上设备名。',
			'help.step_join': '等待批准',
			'help.step_join_desc': '房间里已有的设备会弹出窗口，它批准之后你才进入。',
			'help.security_features': '你需要知道的',
			'help.e2e_encryption': '端到端加密',
			'help.e2e_encryption_desc': '中转端拿到的只有由房间密钥派生出来的房间编号，它收不到房间密钥，也算不出消息密钥。',
			'help.password_enhanced_encryption': '用批准代替密码',
			'help.password_enhanced_encryption_desc': '没有房间密码，新设备由房间里已有的设备批准后加入。',
			'help.no_history': '什么都不保存',
			'help.no_history_desc': '中转端不留任何东西。消息只存在当前在房间里的设备内存中；只要还有一台开着，新加入的设备就能补齐最近的文本消息。',
			'help.anonymous_communication': '不需要账号',
			'help.anonymous_communication_desc': '不用注册、不收集个人信息，只需要填一个你自己写的设备名。',
			'help.decentralized': '跑在 Cloudflare 上',
			'help.decentralized_desc': '以 Cloudflare Worker 部署，不需要自己维护服务器。',			'help.usage_tips': '使用提示',
			'help.important_note': '请注意',
			'help.room_isolation_note': '不同的房间码是两个完全独立的房间，互相看不到。',
			'help.tip_private_chat': '短地址',
			'help.tip_private_chat_desc': '房间码在地址的 # 之后，例如 /#abc123。',
			'help.tip_group_chat': '同时用多个房间',
			'help.tip_group_chat_desc': '同一个标签页里可以加入多个房间，它们会出现在左侧列表。',
			'help.tip_security_reminder': '只在内存里',
			'help.tip_security_reminder_desc': '刷新或关闭标签页，这台设备手上的记录就没了。',
			'help.tip_password_strategy': '批准一次',
			'help.tip_password_strategy_desc': '批准过的设备在一段时间内不用再批准。',
		}
	}
};

// Current language
// 当前语言
let currentLanguage = 'en';

// Get translation for a key
// 获取翻译文本
export function t(key, fallback = key) {
	const lang = LANGUAGES[currentLanguage];
	if (lang && lang.translations && lang.translations[key]) {
		return lang.translations[key];
	}
	return fallback;
}

// Set current language
// 设置当前语言
export function setLanguage(langCode) {
	if (LANGUAGES[langCode]) {
		currentLanguage = langCode;
		// Update document language attribute
		// 更新文档语言属性
		document.documentElement.lang = langCode;
		
		// Update static HTML texts
		// 更新HTML中的静态文本
		updateStaticTexts();
		
		// Dispatch language change event for other components to listen
		// 派发语言变更事件供其他组件监听
		window.dispatchEvent(new CustomEvent('languageChange', { 
			detail: { language: langCode } 
		}));
	}
}

// Get current language
// 获取当前语言
export function getCurrentLanguage() {
	return currentLanguage;
}

// Get all available languages
// 获取所有可用语言
export function getAvailableLanguages() {
	return Object.keys(LANGUAGES).map(code => ({
		code,
		name: LANGUAGES[code].name,
		flag: LANGUAGES[code].flag
	}));
}

// Initialize i18n with settings
// 根据设置初始化国际化
export function initI18n(settings) {
	if (settings && settings.language) {
		setLanguage(settings.language);
	} else {
		// Auto-detect browser language
		// 自动检测浏览器语言
		const browserLang = detectBrowserLanguage();
		setLanguage(browserLang);
	}
}

// Detect browser language and return supported language code
// 检测浏览器语言并返回支持的语言代码
function detectBrowserLanguage() {
	const navigatorLang = navigator.language || navigator.userLanguage || 'en';
	
	// Extract language code (e.g., 'zh-CN' -> 'zh', 'en-US' -> 'en')
	const langCode = navigatorLang.split('-')[0].toLowerCase();
	
	// Check if we support this language
	if (LANGUAGES[langCode]) {
		return langCode;
	}
	
	// Default fallback to English
	return 'en';
}

// Update static HTML text elements
// 更新HTML中的静态文本元素
export function updateStaticTexts() {
	// 如果DOM还没准备好，等待DOM准备好再更新
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => updateStaticTexts());
		return;
	}
	
	// Update login title
	const loginTitle = document.getElementById('login-title');
	if (loginTitle) {
		loginTitle.textContent = t('ui.enter_node', 'Enter a Room');
	}
		// Update login form content with new translations
	const loginFormContainer = document.getElementById('login-form');
	if (loginFormContainer) {
		// Use a custom event to trigger form regeneration instead of dynamic import
		// 使用自定义事件触发表单重新生成，而不是动态导入
		window.dispatchEvent(new CustomEvent('regenerateLoginForm'));
	}
	
	// Update sidebar username label
	const sidebarUsername = document.getElementById('sidebar-username');
	if (sidebarUsername) {
		// Use a custom event to update sidebar username instead of dynamic import
		// 使用自定义事件更新侧边栏用户名，而不是动态导入
		window.dispatchEvent(new CustomEvent('updateSidebarUsername'));
	}
	// Update "Enter a Room" text in sidebar
	const joinRoomText = document.getElementById('join-room-text');
	if (joinRoomText) {
		joinRoomText.textContent = t('ui.enter_node', 'Enter a Room');
	}
	
	// Update Members title in rightbar
	const membersTitle = document.getElementById('members-title');
	if (membersTitle) {
		membersTitle.textContent = t('ui.members', 'Members');
	}
	
	// Update settings title
	const settingsTitle = document.getElementById('settings-title');
	if (settingsTitle) {
		settingsTitle.textContent = t('settings.title', 'Settings');
	}
	
	// Update message placeholder
	const messagePlaceholder = document.querySelector('.input-field-placeholder');
	if (messagePlaceholder) {
		messagePlaceholder.textContent = t('ui.message', 'Message');
	}
	
	// Update attach button title
	const attachBtn = document.querySelector('.chat-attach-btn');
	if (attachBtn) {
		attachBtn.title = t('file.attach_file', 'Attach file');
	}
	
	// Update emoji button title
	const emojiBtn = document.querySelector('.chat-emoji-btn');
	if (emojiBtn) {
		emojiBtn.title = t('action.emoji', 'Emoji');
	}
		// Update settings button title
	const settingsBtn = document.getElementById('settings-btn');
	if (settingsBtn) {
		settingsBtn.title = t('action.settings', 'Settings');
		settingsBtn.setAttribute('aria-label', t('action.settings', 'Settings'));
	}
		// Update back button title
	const backBtn = document.getElementById('settings-back-btn');
	if (backBtn) {
		backBtn.title = t('action.back', 'Back');
		backBtn.setAttribute('aria-label', t('action.back', 'Back'));
	}
	
	// Update all elements with data-i18n attribute
	// 更新所有具有data-i18n属性的元素
	const i18nElements = document.querySelectorAll('[data-i18n]');
	i18nElements.forEach(element => {
		const key = element.getAttribute('data-i18n');
		if (key) {
			element.textContent = t(key, element.textContent || key);
		}
	});
	
	// Update all elements with data-i18n-title attribute
	// 更新所有具有data-i18n-title属性的元素
	const i18nTitleElements = document.querySelectorAll('[data-i18n-title]');
	i18nTitleElements.forEach(element => {
		const key = element.getAttribute('data-i18n-title');
		if (key) {
			element.title = t(key, element.title || key);
		}
	});
	
	// Update meta tags
	// 更新meta标签
	updateMetaTags();
}

// Update meta tags with current language
// 使用当前语言更新meta标签
function updateMetaTags() {
	// Update description meta tag
	const metaDescription = document.querySelector('meta[name="description"]');
	if (metaDescription) {
		metaDescription.content = t('meta.description', metaDescription.content);
	}
	
	// Update keywords meta tag
	const metaKeywords = document.querySelector('meta[name="keywords"]');
	if (metaKeywords) {
		metaKeywords.content = t('meta.keywords', metaKeywords.content);
	}
	
	// Update og:title meta tag
	const metaOgTitle = document.querySelector('meta[property="og:title"]');
	if (metaOgTitle) {
		metaOgTitle.content = t('meta.og_title', metaOgTitle.content);
	}
	
	// Update og:description meta tag
	const metaOgDescription = document.querySelector('meta[property="og:description"]');
	if (metaOgDescription) {
		metaOgDescription.content = t('meta.og_description', metaOgDescription.content);
	}
	
	// Update twitter:title meta tag
	const metaTwitterTitle = document.querySelector('meta[name="twitter:title"]');
	if (metaTwitterTitle) {
		metaTwitterTitle.content = t('meta.twitter_title', metaTwitterTitle.content);
	}
	
	// Update twitter:description meta tag
	const metaTwitterDescription = document.querySelector('meta[name="twitter:description"]');
	if (metaTwitterDescription) {
		metaTwitterDescription.content = t('meta.twitter_description', metaTwitterDescription.content);
	}
}
