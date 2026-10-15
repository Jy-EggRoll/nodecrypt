// Clipboard helper shared by the copy button and the share action
// 剪贴板工具：复制按钮与分享链接共用同一份实现，避免两处各写一套

// Copy plain text, preferring the async Clipboard API
// 复制纯文本，优先用异步剪贴板接口。
// 为什么还要留回退：navigator.clipboard 在非安全上下文（http、局域网 IP 访问）与旧浏览器上
// 要么不存在、要么直接抛错，这条回退是那些环境下唯一还能指望的手段。
// 旧实现走的是 prompt 弹窗让用户自己手选，手机上几乎没法操作，所以换成了可见的按钮反馈。
// @param {string} text 要复制的纯文本
// @returns {Promise<boolean>} 是否复制成功
export async function copyText(text) {
	if (navigator.clipboard && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return true
		} catch (err) {
			// 权限被拒或用户未授权时继续往下试，不在这里直接判失败
		}
	}
	const textarea = document.createElement('textarea');
	textarea.value = text;
	// readonly 避免手机弹出键盘，fixed + 移出视口则不会引起页面滚动
	textarea.setAttribute('readonly', '');
	textarea.style.position = 'fixed';
	textarea.style.top = '-1000px';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	textarea.select();
	let ok = false;
	try {
		ok = document.execCommand('copy')
	} catch (err) {
		ok = false
	}
	document.body.removeChild(textarea);
	return ok
}