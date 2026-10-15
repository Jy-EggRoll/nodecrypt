// Custom audio/video control bar for file messages.
// 文件消息里音视频的自建控件条。
//
// 为什么不用原生 <audio controls>/<video controls>：原生控件的排布由浏览器决定，宽度不足时
// 它会先把时间文字压扁、再把音量条挤成一条缝，在窄气泡里根本点不准；原生控件又不给改这些
// 间距与配色。所以只借用元素本身的解码与播放能力（controls 关掉），界面全部自己画。
//
// 为什么进度条用 <input type="range"> 而不是自己画一根可拖的条：range 自带键盘方向键调整、
// 屏幕阅读器朗读，以及触摸拖动的完整实现，自己画要重新实现一遍这些行为还容易漏掉无障碍。
import { t } from './util.i18n.js';

// 图标用内联 SVG：项目里没有图标字体或图标库，引入一套只为这几个图标不划算。
const ICONS = {
	play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72c0 .86.93 1.4 1.68.97l11.02-6.86a1.14 1.14 0 0 0 0-1.94L9.68 4.17A1.14 1.14 0 0 0 8 5.14z"/></svg>',
	pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h3.6v16H7zM13.4 4H17v16h-3.6z"/></svg>',
	volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
	mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>',
	fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>'
};

// 控件条里不再放下载按钮：文件卡右上角本来就有下载入口，同一张卡片出现两个功能完全相同的
// 按钮只会让人犹豫点哪个；面板腾出的宽度留给进度条与时间文本。

// 进度条的取值范围用整数刻度而不是秒：duration 在部分容器里是 NaN 或 Infinity
// （流式或未知长度的媒体），用 0~1000 的百分比刻度可以先把定位做出来，
// 真实秒数只在写 currentTime 时按当时的 duration 换算。
const SEEK_STEPS = 1000;

const HAVE_METADATA = 1;

/** 秒数转 mm:ss（超过一小时加小时段）。 */
function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const total = Math.floor(seconds);
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function makeButton(className, role, label, icon) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = className;
	btn.dataset.role = role;
	btn.setAttribute('aria-label', label);
	btn.innerHTML = icon;
	return btn;
}

/**
 * 把已经拿到字节的 <audio>/<video> 包成一套自建控件。
 *
 * @param {HTMLMediaElement} media 已经在加载中的音频或视频元素（controls 必须为 false）
 * @returns {HTMLElement} 根节点 .media-panel
 */
export function createMediaPanel(media) {
	const isVideo = media.tagName === 'VIDEO';
	const duration = () => (Number.isFinite(media.duration) ? media.duration : 0);

	const panel = document.createElement('div');
	panel.className = isVideo ? 'media-panel is-video' : 'media-panel';
	panel.dataset.kind = isVideo ? 'video' : 'audio';

	// 视频元素本身留在 DOM 里负责解码与画面，只是不再要浏览器的控件。
	// playsinline 在视频上必须存在：iPhone 上缺少它时播放会强制切进系统全屏播放器，
	// 我们自建的控件条就随着页面一起被盖掉了。
	if (isVideo) {
		media.setAttribute('playsinline', '');
		media.playsInline = true;
		media.classList.add('file-preview-video');
	} else {
		media.classList.add('file-preview-audio');
	}

	const bar = document.createElement('div');
	bar.className = 'media-bar';

	// 播放/暂停
	const playBtn = makeButton('media-play msg-action-btn', 'play', t('media.play', 'Play'), ICONS.play);
	const setPlaying = (playing) => {
		playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
		playBtn.setAttribute('aria-label', playing ? t('media.pause', 'Pause') : t('media.play', 'Play'));
		panel.classList.toggle('is-playing', playing);
	};

	// 进度：input 事件只动界面，change 才真的定位。
	// 为什么分开：拖动过程中每个 input 都会触发，若这时写 currentTime，浏览器会边拖边解码，
	// 而 timeupdate 又反过来把滑块拨回真实播放位置，手指下就会觉得滑块被拽走。
	const seek = document.createElement('input');
	seek.type = 'range';
	seek.className = 'media-progress';
	seek.dataset.role = 'seek';
	seek.min = '0';
	seek.max = String(SEEK_STEPS);
	seek.step = '1';
	seek.value = '0';
	seek.setAttribute('aria-label', t('media.progress', 'Playback position'));

	// 时间文本
	const timeEl = document.createElement('span');
	timeEl.className = 'media-time';
	timeEl.dataset.role = 'time';
	const curEl = document.createElement('span');
	curEl.dataset.role = 'cur';
	curEl.textContent = '0:00';
	const durEl = document.createElement('span');
	durEl.dataset.role = 'dur';
	durEl.textContent = '0:00';
	timeEl.append(curEl, document.createTextNode(' / '), durEl);

	// 音量按钮（能力探测不通过时会被移除，见下面的 probeVolume）
	const volBtn = makeButton(
		'msg-action-btn media-volume',
		'vol',
		t('media.mute', 'Mute'),
		ICONS.volume
	);
	const syncVolume = () => {
		const muted = media.muted;
		volBtn.innerHTML = muted ? ICONS.mute : ICONS.volume;
		volBtn.setAttribute('aria-label', muted ? t('media.unmute', 'Unmute') : t('media.mute', 'Mute'));
		volBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
	};

	let scrubbing = false;
	let loading = false;

	const paint = () => {
		const d = duration();
		const ratio = d > 0 ? Math.min(1, Math.max(0, media.currentTime / d)) : 0;
		// 轨道用 CSS 变量分成已播/已缓冲/未播三段，颜色仍取自项目现有配色
		seek.style.setProperty('--p', `${(ratio * 100).toFixed(2)}%`);
		curEl.textContent = formatTime(media.currentTime);
		if (!scrubbing) seek.value = String(Math.round(ratio * SEEK_STEPS));
	};

	const paintBuffer = () => {
		const d = duration();
		let end = 0;
		try {
			if (media.buffered && media.buffered.length > 0) end = media.buffered.end(media.buffered.length - 1);
		} catch (error) {
			end = 0;
		}
		const ratio = d > 0 ? Math.min(1, Math.max(0, end / d)) : 0;
		seek.style.setProperty('--b', `${(ratio * 100).toFixed(2)}%`);
	};

	const setLoading = (value) => {
		if (loading === value) return;
		loading = value;
		panel.classList.toggle('is-loading', value);
		// 载入中禁掉按钮，避免用户在还不知道能不能播的时候连点；
		// 转圈的反馈由 CSS 做在播放图标上（不用 emoji：字形在不同系统上宽窄不一）。
		for (const btn of [playBtn, volBtn, ...(fsBtn ? [fsBtn] : [])]) btn.disabled = value;
	};

	const toggle = () => {
		if (media.paused) {
			// play() 的 Promise 必须接住：自动播放策略会拒掉它，不接就是一条未处理的
			// rejection，界面还会停在暂停图标上骗用户“已经播了”。
			const started = media.play();
			if (started && typeof started.catch === 'function') {
				started.catch(() => {
					setPlaying(false);
					setLoading(false);
				});
			}
		} else {
			media.pause();
		}
	};

	playBtn.addEventListener('click', toggle);

	// 音量能力探测：iOS Safari 的 HTMLMediaElement.volume 恒为 1，赋值无效也不报错，
	// 留着一个点了没反应的按钮比没有按钮更糟，所以探测失败时直接移除音量控件，
	// 而不是显示一句“本机不支持调音量”的提示文字去解释一个本可以不存在的东西。
	let volumeProbed = false;
	const probeVolume = () => {
		if (volumeProbed || media.readyState < HAVE_METADATA) return;
		volumeProbed = true;
		const before = media.volume;
		let writable = false;
		try {
			media.volume = 0.5;
			writable = media.volume === 0.5;
		} catch (error) {
			writable = false;
		}
		// 探测不能留下副作用：还原成探测前的音量（默认 1），否则每次预览都变成半音量，
		// 用户会以为是文件本身的问题。
		try {
			media.volume = before;
		} catch (error) {
			/* 不可写时上面这句同样无效，忽略即可 */
		}
		if (!writable) volBtn.remove();
	};

	volBtn.addEventListener('click', () => {
		media.muted = !media.muted;
		syncVolume();
	});

	// 全屏：能力探测，两者都没有就不显示这个按钮。
	// requestFullscreen 是标准入口，webkitEnterFullscreen 是 iOS Safari 上视频元素专有的那条路。
	const canFullscreen = isVideo && (typeof media.requestFullscreen === 'function' || typeof media.webkitEnterFullscreen === 'function');
	let fsBtn = null;
	if (canFullscreen) {
		fsBtn = makeButton(
			'msg-action-btn media-fullscreen',
			'fs',
			t('media.fullscreen', 'Fullscreen'),
			ICONS.fullscreen
		);
		fsBtn.addEventListener('click', () => {
			if (typeof media.requestFullscreen === 'function') {
				const asked = media.requestFullscreen();
				if (asked && typeof asked.catch === 'function') asked.catch(() => {});
			} else if (typeof media.webkitEnterFullscreen === 'function') {
				media.webkitEnterFullscreen();
			}
		});
	}

	// 视频：画面上的大播放按钮。自己画的控件条在画面外，指到画面上再点一下是通用习惯，
	// 所以画面本身也作为播放/暂停的开关。
	let stage = null;
	let bigPlay = null;
	if (isVideo) {
		stage = document.createElement('div');
		stage.className = 'media-stage';
		bigPlay = makeButton('media-bigplay', 'bigplay', t('media.play', 'Play'), ICONS.play);
		bigPlay.addEventListener('click', (event) => {
			event.stopPropagation();
			toggle();
		});
		stage.addEventListener('click', toggle);
		stage.append(media, bigPlay);
		panel.appendChild(stage);
	} else {
		// 音频元素不发画面，但必须留在文档里才能播放；由 CSS 收起。
		panel.appendChild(media);
	}

	bar.append(playBtn, seek, timeEl, volBtn);
	if (fsBtn) bar.appendChild(fsBtn);
	panel.appendChild(bar);

	seek.addEventListener('input', () => {
		scrubbing = true;
		const d = duration();
		const position = (Number(seek.value) / SEEK_STEPS) * d;
		curEl.textContent = formatTime(position);
		const ratio = d > 0 ? position / d : 0;
		seek.style.setProperty('--p', `${(ratio * 100).toFixed(2)}%`);
	});
	// change 只在拖动/键盘调整结束时触发一次，这时才真的定位
	seek.addEventListener('change', () => {
		const d = duration();
		if (d > 0) media.currentTime = (Number(seek.value) / SEEK_STEPS) * d;
		scrubbing = false;
		paint();
	});

	media.addEventListener('loadedmetadata', () => {
		durEl.textContent = formatTime(media.duration);
		probeVolume();
		paint();
	});
	media.addEventListener('durationchange', () => {
		durEl.textContent = formatTime(media.duration);
		paintBuffer();
	});
	media.addEventListener('timeupdate', () => {
		if (!scrubbing) paint();
	});
	media.addEventListener('progress', paintBuffer);
	media.addEventListener('play', () => setPlaying(true));
	media.addEventListener('pause', () => setPlaying(false));
	media.addEventListener('ended', () => {
		setPlaying(false);
		setLoading(false);
		paint();
	});
	media.addEventListener('playing', () => setLoading(false));
	media.addEventListener('canplay', () => setLoading(false));
	media.addEventListener('seeked', () => setLoading(false));
	media.addEventListener('waiting', () => setLoading(true));
	media.addEventListener('seeking', () => setLoading(true));
	media.addEventListener('volumechange', syncVolume);

	// 走到这里时必须已经能给出时长：createMediaPanel 由 tryMedia 在 loadedmetadata 之后调用，
	// 但作为公开接口也可能拿到还没加载的元素，两种情况下这里都要把当前状态画出来。
	if (media.readyState >= HAVE_METADATA) {
		durEl.textContent = formatTime(media.duration);
		probeVolume();
		paint();
		paintBuffer();
		setLoading(false);
	} else {
		setLoading(true);
	}
	setPlaying(!media.paused && !media.ended);
	syncVolume();

	return panel;
}