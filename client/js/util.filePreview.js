// Inline preview for file messages: images, audio/video and Markdown
// 文件消息的就地预览：图片、音视频、Markdown
//
// 为什么不用类型白名单：能不能预览由浏览器自己回答——图片交给 <img> 的 error 事件、
// 音视频交给 <audio>/<video> 的 error 事件、文本交给 TextDecoder 的 fatal 解码失败。
// 这份文件里唯一的“类型表”只是尝试顺序的提示，决定不了结论：扩展名不在表里也不会被
// 拒绝，仍按兜底顺序逐个尝试，任何一步真的加载成功就算可预览。
//
// 为什么先试谁很重要：一次尝试要真的把字节交给浏览器解码，失败才知道不支持。顺序错
// 了就会把图片当文本读，所以按扩展名排个先后能少走弯路，但排错也只是多花几十毫秒。

import { renderMarkdown } from './util.markdown.js';
import { t } from './util.i18n.js';
import { createMediaPanel } from './util.mediaPlayer.js';

// 扩展名 → 尝试顺序的提示。只排先后，不做准入判断。
const HINTED_ORDERS = [
	{ pattern: /\.(png|jpe?g|gif|webp|avif|bmp|ico|svgz?|heic|heif)$/i, kinds: ['image'] },
	{ pattern: /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|amr)$/i, kinds: ['audio'] },
	{ pattern: /\.(mp4|m4v|webm|ogv|mov|mkv|3gp)$/i, kinds: ['video'] },
	{ pattern: /\.(md|markdown|mdown|mkd|mdx)$/i, kinds: ['markdown'] }
];

// 表里没有的扩展名走这条路：图片、文本、音频、视频都试一遍，全失败才回退下载。
const DEFAULT_ORDER = ['image', 'markdown', 'audio', 'video'];

// 加载超时：个别浏览器对不认识的编码既不发 error 也不发 loadedmetadata，
// 只靠事件会一直停在载入中，所以留一个上限，超时按“播不了”处理。
const PROBE_TIMEOUT_MS = 10000;

function hintedKinds(fileName) {
	const name = String(fileName || '');
	for (const entry of HINTED_ORDERS) {
		if (entry.pattern.test(name)) return entry.kinds;
	}
	return null;
}

// 决定尝试顺序：先按扩展名提示，再兜底。提示到的类型单独判定失败原因，兜底顺序失败时
// 只说“试过的都不行”，避免拿某一步的原因去解释整条链。
export function attemptOrder(fileName) {
	const hinted = hintedKinds(fileName);
	return {
		kinds: hinted || DEFAULT_ORDER,
		hintedOnly: hinted !== null
	};
}

/** 给一次尝试加超时：resolve/reject 只会生效一次。 */
function withTimeout(promise, onTimeout) {
	let timer = null;
	return new Promise((resolve, reject) => {
		timer = setTimeout(() => {
			reject(new Error(onTimeout()));
		}, PROBE_TIMEOUT_MS);
		promise.then(resolve, reject);
	}).finally(() => {
		if (timer !== null) clearTimeout(timer);
	});
}

/**
 * 图片：让 <img> 自己去解。
 * 刻意不做 MIME 判断：浏览器支持的图片格式远比一份清单能列全的多，
 * 而“解不出来就 error”恰好是我们想要的那个结论。
 */
function tryImage(blob, fileName) {
	return withTimeout(
		new Promise((resolve, reject) => {
			const url = URL.createObjectURL(blob);
			const img = document.createElement('img');
			img.className = 'file-preview-image';
			img.alt = fileName;
			img.onload = () => resolve({ node: img, url });
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error(t('preview.image_failed', 'This browser cannot display that image format.')));
			};
			img.src = url;
		}),
		() => t('preview.image_failed', 'This browser cannot display that image format.')
	);
}

/**
 * 音频与视频：先把字节拼成 Blob，再用 createObjectURL 交给播放器。
 *
 * 为什么不用普通地址直连：这里的字节本来就没有可取的地址——文件是设备之间点对点传的，
 * 分卷只躺在内存里，没有服务端能响应字节区间（Range）请求。播放器拿不到区间支持时会
 * 拒绝播放（Safari 尤其严格），所以只能整段交给它，好在本地 blob 的拖动与播放都不受
 * 影响。代价是解码前要等分卷解压完，所以预览位置先显示载入状态。
 */
function tryMedia(blob, kind, fileName) {
	const isAudio = kind === 'audio';
	const reason = isAudio
		? t('preview.audio_failed', 'This browser cannot play that audio format.')
		: t('preview.video_failed', 'This browser cannot play that video format.');

	return withTimeout(
		new Promise((resolve, reject) => {
			const url = URL.createObjectURL(blob);
			const el = document.createElement(isAudio ? 'audio' : 'video');
			el.className = isAudio ? 'file-preview-audio' : 'file-preview-video';
			// 不要原生控件：窄气泡里原生控件会先压扁时间、再挤没音量条，改不动也点不准。
			// 播放与解码仍由这个元素负责，界面交给 createMediaPanel。见 util.mediaPlayer.js。
			el.controls = false;
			el.preload = 'auto';
			if (!isAudio) {
				el.playsInline = true;
				el.setAttribute('playsinline', '');
			}
			// 等元数据到齐再包控件条：时长、能不能写音量这两件事都要读元数据才有结论。
			el.onloadedmetadata = () =>
				resolve({
					node: createMediaPanel(el),
					url
				});
			el.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error(reason));
			};
			el.src = url;
		}),
		() => reason
	);
}

/**
 * 文本类：用 fatal 解码判断“这是不是能读的文本”，解码失败即当二进制处理。
 * 判据是浏览器的解码器而不是扩展名——扩展名改成 .md 也救不了一个压缩包。
 */
async function tryMarkdown(blob, fileName) {
	const text = await decodeText(blob, fileName);
	const node = document.createElement('article');
	// 用共用渲染器的默认配置（breaks: false）：文件是按标准文档读的，
	// 单个换行只应是折行，不该变成段落内的硬换行。
	node.className = 'file-preview-markdown md-body';
	node.innerHTML = renderMarkdown(text, { breaks: false });
	return { node, url: null };
}

async function decodeText(blob, fileName) {
	const buffer = await blob.arrayBuffer();
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch (error) {
		throw new Error(t('preview.text_failed', 'This file is not readable text, so it cannot be rendered.'));
	}
	// NUL 字节是二进制文件的强信号，即使它碰巧是合法 UTF-8 也不该按 Markdown 渲染。
	if (text.indexOf('\u0000') !== -1) {
		throw new Error(t('preview.text_failed', 'This file is not readable text, so it cannot be rendered.'));
	}
	return text;
}

function runProbe(kind, blob, fileName) {
	if (kind === 'image') return tryImage(blob, fileName);
	if (kind === 'markdown') return tryMarkdown(blob, fileName);
	return tryMedia(blob, kind, fileName);
}

/** 预览失败后的兜底：说清为什么看不了，并留下载入口。 */
function renderFallback(slot, { reason, fileId, canDownload }) {
	slot.dataset.previewState = 'failed';
	const box = document.createElement('div');
	box.className = 'file-preview-fallback';

	const reasonEl = document.createElement('div');
	reasonEl.className = 'file-preview-reason';
	reasonEl.textContent = `${t('preview.unavailable', 'Preview unavailable')}: ${reason}`;
	box.appendChild(reasonEl);

	if (canDownload) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'msg-action-btn file-preview-download';
		btn.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3C12.5523 3 13 3.44772 13 4V12.5858L15.2929 10.2929C15.6834 9.90237 16.3166 9.90237 16.7071 10.2929C17.0976 10.6834 17.0976 11.3166 16.7071 11.7071L12.7071 15.7071C12.3166 16.0976 11.6834 16.0976 11.2929 15.7071L7.29289 11.7071C6.90237 11.3166 6.90237 10.6834 7.29289 10.2929C7.68342 9.90237 8.31658 9.90237 8.70711 10.2929L11 12.5858V4C11 3.44772 11.4477 3 12 3ZM4 17C4 16.4477 4.44772 16 5 16C5.55228 16 6 16.4477 6 17V18C6 18.5523 6.44772 19 7 19H17C17.5523 19 18 18.5523 18 18V17C18 16.4477 18.4477 16 19 16C19.5523 16 20 16.4477 20 17V18C20 19.6569 18.6569 21 17 21H7C5.34315 21 4 19.6569 4 18V17Z" fill="currentColor"/></svg>';
		btn.title = t('preview.download_view', 'Download to view');
		btn.addEventListener('click', () => {
			if (typeof window.downloadFile === 'function') window.downloadFile(fileId);
		});
		box.appendChild(btn);
	}

	slot.replaceChildren(box);
}

/** 把已经渲染好的节点放进预览位置，并记下 blob 地址，替换时回收。 */
function showNode(slot, node, url) {
	if (slot.dataset.previewUrl) URL.revokeObjectURL(slot.dataset.previewUrl);
	slot.dataset.previewUrl = url || '';
	slot.dataset.previewState = 'ready';
	slot.replaceChildren(node);
}

/**
 * 渲染一条文件消息的预览。
 * 调用方负责把字节准备好（见 util.file.js 的 getPreviewBlob），这里只做尝试与回退。
 */
export async function mountFilePreview(slot, { blob, fileName, fileId, canDownload }) {
	const { kinds, hintedOnly } = attemptOrder(fileName);
	slot.dataset.previewState = 'loading';
	slot.textContent = t('preview.loading', 'Loading preview…');

	const reasons = [];
	for (const kind of kinds) {
		try {
			const { node, url } = await runProbe(kind, blob, fileName);
			showNode(slot, node, url);
			return true;
		} catch (error) {
			reasons.push(error.message);
		}
	}

	// 提示只指了一种类型时，那条失败原因就是最精准的解释（“播不了这个格式”）；
	// 兜底顺序是挨个猜的，用其中某一步的原因解释整体会误导，所以给一句总的说明。
	renderFallback(slot, {
		reason: hintedOnly && reasons.length === 1 ? reasons[0] : t('preview.unsupported', 'This browser cannot preview this file.'),
		fileId,
		canDownload
	});
	return false;
}