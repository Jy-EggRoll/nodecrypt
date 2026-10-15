// Shared Markdown renderer for chat messages and file previews
// 聊天消息与文件预览共用的 Markdown 渲染器
//
// 为什么两份调用方共用同一个解析器：聊天里的文本消息和文件预览里的 Markdown 文档，
// 需要的是同一件事——把 Markdown 变成安全的 HTML。曾经各写一份 marked 配置与净化调用，
// 结果是安全策略和排版规则都要改两遍，改一处漏一处就会出现“文件里安全、消息里不安全”
// 这种最难查的漏洞。所以解析与净化只在本文档里配置一份，调用方只决定要不要软换行。
//
// 为什么 breaks 是参数而不是写死：
//   聊天消息 breaks: true —— 用户在输入框里按回车就是要换行，这是打字习惯，不是文档结构；
//   文件预览 breaks: false —— 那是按标准文档读的，单个换行在 Markdown 里就只是折行。
// 这个差异是实测确认过的（同一段带单换行的文字，两种配置渲染结果不同），不是猜测，
// 所以它必须能由调用方指定，不能由渲染器替调用方决定。

import DOMPurify from 'dompurify';
import { Marked } from 'marked';

// marked 只配置一次。这里以实例方式持有，不走全局单例，避免别处 use() 改配置时
// 连带影响本文档的渲染结果。breaks 每次解析时按调用方给的值覆盖，所以下面配的
// 只是默认值。
const markdown = new Marked();

// 链接一律在新标签打开：渲染出来的内容来自别人发来的消息，在当前页跳转等于把聊天页
// 换掉。DOMPurify 默认会保留 target 与 rel，但这两个属性是安全相关的外链策略，
// 显式写进允许项，以免将来收窄配置时被静默抹掉（抹掉后点击会在当前页跳转）。
const purifierConfig = {
	FORBID_ATTR: ['style'],
	ADD_ATTR: ['target', 'rel']
};

// marked 自己会转义文本节点，但 href/title 是原样拼进属性里的，这里补一次属性转义，
// 防止链接目标里的引号把属性截断、顺带塞进别的属性。链接里的 javascript: 之类
// 由之后的 DOMPurify 按 URL 协议白名单拦掉。
function escapeAttr(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

markdown.use({
	gfm: true,
	breaks: false, // 默认按标准文档渲染，聊天消息由调用方显式打开软换行
	renderer: {
		// 必须是普通函数而不是箭头函数：marked 15 在调用自定义 renderer 时把 this 绑成
		// 渲染器实例，子级行内内容要靠 this.parser.parseInline 才能渲染出 <strong> 之类。
		link({ href, title, tokens }) {
			const text = this.parser.parseInline(tokens);
			const label = title ? ` title="${escapeAttr(title)}"` : '';
			return `<a href="${escapeAttr(href)}"${label} target="_blank" rel="noopener noreferrer">${text}</a>`;
		}
	}
});

/**
 * 把 Markdown 文本渲染成可以安全写进 innerHTML 的 HTML 字符串。
 *
 * 顺序是解析再净化，不能反过来：反了就等于把原始内容先当 HTML 交给 innerHTML，
 * 文件或消息里的 <script>、onerror 之类会直接执行。
 *
 * @param {string} text Markdown 原文
 * @param {{ breaks?: boolean }} [options] breaks 为 true 时单个换行也变成换行（聊天消息用）
 * @returns {string} 净化后的 HTML，输入不是字符串时返回空字符串
 */
export function renderMarkdown(text, { breaks = false } = {}) {
	if (typeof text !== 'string' || text === '') return '';
	const html = markdown.parse(text, { async: false, breaks });
	return DOMPurify.sanitize(html, purifierConfig);
}