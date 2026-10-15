// Import necessary modules
// 导入必要的模块
import { deflate, inflate } from 'fflate';
import { showFileUploadModal, queueFilesForUpload } from './util.fileUpload.js';
import { mountFilePreview } from './util.filePreview.js';
import { t } from './util.i18n.js';

// 分卷大小统一配置
// 256 KiB 是体积与条数的折中：一卷 base64 后约 341 KiB，还要再经内层加密、
// 外层信封两次 base64 才成为一条 WebSocket 消息，卷越大越容易逼近单条消息 8 MB 的上限。
const DEFAULT_VOLUME_SIZE = 256 * 1024;

// File transfer state management
// 文件传输状态管理
window.fileTransfers = new Map();

// Base64 encoding for binary data (more efficient than hex)
// Base64编码用于二进制数据（比十六进制更高效）
function arrayBufferToBase64(buffer) {
	const uint8Array = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000; // 32KB chunks to avoid call stack limits
	
	for (let i = 0; i < uint8Array.length; i += chunkSize) {
		const chunk = uint8Array.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk);
	}
	
	return btoa(binary);
}

// Base64 decoding back to binary
// Base64解码回二进制数据
function base64ToArrayBuffer(base64) {
	const binary = atob(base64);
	const uint8Array = new Uint8Array(binary.length);
	
	for (let i = 0; i < binary.length; i++) {
		uint8Array[i] = binary.charCodeAt(i);
	}
	
	return uint8Array;
}

// Generate unique file ID
// 生成唯一文件ID
function generateFileId() {
	return 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Calculate SHA-256 hash for data integrity verification
// 计算SHA-256哈希值用于数据完整性验证
async function calculateHash(data) {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}



// Compress file into volumes with optimized compression
// 将文件压缩为分卷，优化压缩算法
async function compressFileToVolumes(file, volumeSize = DEFAULT_VOLUME_SIZE) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = async function(e) {
			const arrayBuffer = new Uint8Array(e.target.result);
			
			try {
				// Calculate hash of original file for integrity
				const originalHash = await calculateHash(arrayBuffer);
				
				// Use single compression pass with balanced compression
				// 使用单次压缩，平衡压缩率和速度
				deflate(arrayBuffer, { 
					level: 6, // 平衡压缩级别
					mem: 8    // 合理内存使用
				}, (err, compressed) => {
					if (err) {
						reject(err);
						return;
					}
					
					// Split compressed data into volumes
					const volumes = [];
					for (let i = 0; i < compressed.length; i += volumeSize) {
						const volume = compressed.slice(i, i + volumeSize);
						volumes.push(arrayBufferToBase64(volume));
					}
					
					resolve({
						volumes,
						originalSize: file.size,
						compressedSize: compressed.length,
						originalHash
					});
				});
			} catch (hashError) {
				reject(hashError);
			}
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(file);
	});
}



// Decompress volumes back to raw bytes (no download, no disk write)
// 将分卷解压回原始字节（不下载、不落盘）
// 预览与下载都要这份字节，所以只有这一处实现：分卷拼接顺序、哈希校验这些细节
// 一旦出现第二份实现就会慢慢走偏，校验被漏掉的那一份迟早会放出坏文件。
async function decompressVolumesToBytes(volumes, originalHash = null) {
	try {
		// Combine all volumes using base64 decoding
		const combinedData = volumes.map(volume => {
			return base64ToArrayBuffer(volume);
		});
		
		const totalLength = combinedData.reduce((sum, arr) => sum + arr.length, 0);
		const compressed = new Uint8Array(totalLength);
		let offset = 0;
		
		for (const data of combinedData) {
			compressed.set(data, offset);
			offset += data.length;
		}
				// Decompress
		return new Promise((resolve, reject) => {
			inflate(compressed, async (err, decompressed) => {
				if (err) {
					reject(err);
					return;
				}
				
				// Verify hash if provided
				if (originalHash) {
					try {
						const calculatedHash = await calculateHash(decompressed);
						if (calculatedHash !== originalHash) {
							reject(new Error('File integrity check failed: hash mismatch'));
							return;
						}
					} catch (hashError) {
						reject(new Error('File integrity check failed: ' + hashError.message));
						return;
					}
				}
				
				resolve(decompressed);
			});
		});
	} catch (error) {
		console.error('Decompression error:', error);
		throw error;
	}
}

// Decompress volumes back to file
// 将分卷解压回文件
async function decompressVolumesToFile(volumes, fileName, originalHash = null) {
	const decompressed = await decompressVolumesToBytes(volumes, originalHash);

	// Create blob and download
	const blob = new Blob([decompressed]);
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}



// Setup file sending functionality
// 设置文件发送功能
// 三个入口——附件按钮、页面任意位置拖入、页面任意位置粘贴——都汇进同一个待发列表，
// 也就是 showFileUploadModal 打开的那个模态框。图片与文件因此共用一条传输管道，
// 不再有第二条把图片内联进消息的路径。
export function setupFileSend({ attachBtnSelector, onSend }) {
	// 待发列表确认后走到这里，把文件交给分卷传输。
	// 设备名不在这里补：main.js 传进来的 onSend 会用当前房间的设备名补上。
	const sendSelectedFiles = async (files) => {
		await handleFilesUpload(files, onSend);
	};

	const attachBtn = document.querySelector(attachBtnSelector);
	if (attachBtn) {
		// 点击附件按钮显示文件上传模态框
		// Click attach button to show file upload modal
		attachBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();

			showFileUploadModal(sendSelectedFiles);
		});
	}

	// 页面任意位置粘贴：剪贴板里的截图与文件都进待发列表
	document.addEventListener('paste', (event) => {
		const data = event.clipboardData;
		if (!data) return;

		const files = [];
		for (const item of data.items) {
			if (item.kind !== 'file') continue;
			const file = item.getAsFile();
			if (file) files.push(withUsableName(file, files.length));
		}
		if (files.length === 0) return;

		// 焦点在可编辑控件里、剪贴板又同时带文本时，让原生粘贴生效：从网页复制的
		// 选区常常既有文字又有图片，这时用户要的多半是文字。截图与从文件管理器复制的
		// 文件都不带文本，仍然会走下面这条路。
		if (isEditableElement(document.activeElement) && data.getData('text/plain')) {
			return;
		}

		event.preventDefault();
		queueFilesForUpload(files, sendSelectedFiles);
	});

	// 页面任意位置拖入：只认带文件的拖拽，输入框里拖动选中的文字不受影响
	document.addEventListener('dragover', (event) => {
		if (hasDraggedFiles(event.dataTransfer)) {
			event.preventDefault();
		}
	});
	document.addEventListener('drop', (event) => {
		if (!hasDraggedFiles(event.dataTransfer)) return;
		// 不拦下来的话，浏览器会直接打开被拖进来的文件，等于把当前页面丢掉
		event.preventDefault();
		queueFilesForUpload(Array.from(event.dataTransfer.files), sendSelectedFiles);
	});
}

// 拖拽里是否带着文件。拖动选中的文字时 types 里没有 Files，那种情况不能拦。
function hasDraggedFiles(dataTransfer) {
	if (!dataTransfer) return false;
	return Array.from(dataTransfer.types || []).includes('Files');
}

// 焦点是否落在自己就能接受粘贴的控件上
function isEditableElement(element) {
	if (!element) return false;
	if (element.isContentEditable) return true;
	return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

// MIME 子类型与常见后缀不一致的几种，逐个列出
const MIME_EXTENSION_ALIASES = {
	jpeg: 'jpg',
	plain: 'txt',
	markdown: 'md',
	mpeg: 'mp3',
	quicktime: 'mov',
	'x-matroska': 'mkv',
	'x-msvideo': 'avi'
};

// 从 MIME 推一个后缀，认不出来就用 bin
// 后缀只影响预览方式，影响不了实际字节与完整性校验，所以这里不必求全。
function extensionFromMime(mime) {
	const subtype = String(mime || '').split('/')[1] || '';
	const normalized = subtype.replace(/\+.*$/, '').toLowerCase();
	if (MIME_EXTENSION_ALIASES[normalized]) return MIME_EXTENSION_ALIASES[normalized];
	if (/^[a-z0-9]{2,5}$/.test(normalized)) return normalized;
	return 'bin';
}

// 给剪贴板里的文件补一个能用的名字
// 文件卡的内联预览按文件名后缀认类型（见 util.filePreview.js），而剪贴板里的截图
// 常常没有名字或没有后缀，只叫 image 或者 blob；这种名字会让图片退化成一张只有
// 下载按钮的卡片，所以按 MIME 补出后缀。已经带后缀的名字一律照原样使用：从文件
// 管理器复制过来的文件带着真实文件名，改名会让接收方收到一个自己没发过的名字。
function withUsableName(file, index) {
	const name = file.name || '';
	if (/\.[a-z0-9]{1,6}$/i.test(name)) return file;

	// 没有后缀时，只有靠后缀才能预览的类型值得补名；一个叫 Makefile 的文件
	// 补成 pasted-xxx.bin 反而更糟。
	const previewableByExtension = /^(image|audio|video)\//i.test(file.type || '')
		|| file.type === 'application/pdf';
	if (name && !previewableByExtension) return file;

	const stamp = new Date();
	const pad = (value) => String(value).padStart(2, '0');
	const datePart = [stamp.getFullYear(), pad(stamp.getMonth() + 1), pad(stamp.getDate())].join('');
	const timePart = [pad(stamp.getHours()), pad(stamp.getMinutes()), pad(stamp.getSeconds())].join('');
	const suffix = index > 0 ? `-${index + 1}` : '';
	const extension = extensionFromMime(file.type);

	return new File([file], `pasted-${datePart}-${timePart}${suffix}.${extension}`, {
		type: file.type,
		lastModified: file.lastModified
	});
}

// Handle files upload
// 处理文件上传
// 一个文件一条消息：多选不再打包成归档。归档卡只有文件名这样的线索，里面的字节
// 既不能逐个预览也不能逐个下载；各自成卡之后每个文件都能独立预览、独立下载，
// 也让图片这类需要内联预览的文件不必再另走一条专用路径。
async function handleFilesUpload(files, onSend) {
	if (!files || files.length === 0) return;

	for (const file of files) {
		try {
			await sendOneFile(file, onSend);
		} catch (error) {
			console.error('File compression error:', error);
			if (window.addSystemMsg) {
				window.addSystemMsg(`Failed to compress files: ${error.message}`);
			}
		}
	}
}

// Compress one file and send it as a transfer of its own
// 压缩一个文件，并用它自己的一组消息发出去
async function sendOneFile(file, onSend) {
	const fileId = generateFileId();
	const { volumes, originalSize, compressedSize, originalHash } = await compressFileToVolumes(file);

	// Create file transfer state
	const fileTransfer = {
		fileId,
		fileName: file.name,
		originalSize,
		compressedSize,
		totalVolumes: volumes.length,
		sentVolumes: 0,
		status: 'sending',
		originalHash,
		// 留一份原始 File 的引用，发送方才能预览自己刚发出去的文件。
		// 这只是引用，浏览器背后是磁盘上的文件，不会额外占一份内存；
		// 分卷（volumes）不能这么留，那是实打实的内存。
		sourceFile: file
	};

	window.fileTransfers.set(fileId, fileTransfer);

	// Send file start message
	const startResult = onSend({
		type: 'file_start',
		fileId,
		fileName: file.name,
		originalSize,
		compressedSize,
		totalVolumes: volumes.length,
		originalHash
	});
	if (startResult !== true) {
		// 起始消息没发出去，后面的分卷到了接收方也只是孤儿：那边不知道有这个文件
		failTransfer(fileId, startResult);
		return;
	}

	// Send volumes
	await sendVolumes(fileId, volumes, onSend);
}

// 传输中断时给用户一个准确的说明
// 发不出去的原因不止一种：连接断开、单条消息超过上限、根本不在房间里。统统一句
// “超过上限”会把排查方向带偏，断线时尤其明显（那时和体积毫无关系）。
function addTransferStoppedMessage(reason) {
	if (!window.addSystemMsg) return;
	// 私聊对象尚未就绪时，main.js 已经就地提示过，不再重复第二条
	if (reason === 'peer-not-ready') return;
	if (reason === 'offline') {
		window.addSystemMsg(t('file.transfer_stopped_offline', 'Transfer stopped: the connection dropped before the file finished'));
		return;
	}
	if (reason === 'no-room') {
		window.addSystemMsg(t('file.transfer_stopped_no_room', 'Transfer stopped: you are not in a room'));
		return;
	}
	window.addSystemMsg(t('file.transfer_stopped_hint', 'Transfer stopped: a chunk could not be sent; usually because one message exceeded the size the server accepts (more members in the room makes each message larger)'));
}

// 把一次传输标记为中断，并说明原因
function failTransfer(fileId, reason) {
	const transfer = window.fileTransfers.get(fileId);
	if (transfer) {
		transfer.status = 'failed';
	}
	updateFileProgress(fileId);
	addTransferStoppedMessage(reason);
}

// Send volumes
// 发送分卷
async function sendVolumes(fileId, volumes, onSend) {
	const fileTransfer = window.fileTransfers.get(fileId);
	if (!fileTransfer) return;
	
	let currentVolume = 0;
	const batchSize = 5; // 每批发送5个分卷
	
	function sendNextBatch() {
		if (currentVolume >= volumes.length) {
			// 发送完成消息。它发不出去时，接收方拿不到“收完了”的信号，会一直停在
			// 接收中，所以这里同样要检查，把它当成传输中断。
			const completeResult = onSend({
				type: 'file_complete',
				fileId
			});
			if (completeResult !== true) {
				failTransfer(fileId, completeResult);
				return;
			}
			
			fileTransfer.status = 'completed';
			updateFileProgress(fileId);
			return;
		}
		
		// 发送当前批次
		const batchEnd = Math.min(currentVolume + batchSize, volumes.length);
		const batch = [];
		
		for (let i = currentVolume; i < batchEnd; i++) {
			batch.push({
				type: 'file_volume',
				fileId,
				volumeIndex: i,
				volumeData: volumes[i],
				isLast: i === volumes.length - 1
			});
		}
		
		// 发送批次中的所有分卷
		// 传输层在单条消息超过上限时会拒发并返回 false，这里必须检查：漏检就等于
		// 无声丢掉这一卷，接收方永远收不满分卷，两边都停在进度条中间且没有报错。
		// 用 map 而不是 some：some 会在遇到第一处拒发时短路，同批剩下的卷就连试都不试。
		const refusal = batch
			.map((volumeMsg) => onSend(volumeMsg))
			.find((result) => result !== true);
		if (refusal !== undefined) {
			failTransfer(fileId, refusal);
			return;
		}
		
		// 更新发送进度
		fileTransfer.sentVolumes = batchEnd;
		updateFileProgress(fileId);
		
		currentVolume = batchEnd;
		
		// 继续发送下一批，使用较短的延迟
		setTimeout(sendNextBatch, 100);
	}
	
	// 开始发送
	sendNextBatch();
}

// Update file progress in chat
// 更新聊天中的文件进度
function updateFileProgress(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer) return;
	const elements = document.querySelectorAll(`[data-file-id="${fileId}"]`);
	elements.forEach(element => {
		const progressContainer = element.querySelector('.file-progress-container');
		const progressBar = element.querySelector('.file-progress');
		const statusText = element.querySelector('.file-status');
		const downloadBtn = element.querySelector('.file-download-btn');
		
		// 判断是否为发送方（发送方没有volumeData）
		const isSender = !transfer.volumeData || transfer.volumeData.length === 0;
		
		if (transfer.status === 'sending') {
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = `${t('file.sending', 'Sending')} ${transfer.sentVolumes}/${transfer.totalVolumes}`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'receiving') {
			const progress = (transfer.receivedVolumes.size / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = `${t('file.receiving', 'Receiving')} ${transfer.receivedVolumes.size}/${transfer.totalVolumes}`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'completed') {
			// 字节刚齐，立刻挂预览：预览位与下载按钮的显隐互不干扰，不必等按钮动画。
			mountFilePreviews(element);
			// 进度区直接撤掉，不做淡出：卡片重绘时（切走房间再切回）本来就不带进度区，
			// 留着淡出会让进度条在这几百毫秒里贴住刚出现的预览图。
			if (progressContainer) {
				progressContainer.style.display = 'none';
			}
			
			if (downloadBtn) {
				// 只有接收方才显示下载按钮
				if (isSender) {
					downloadBtn.classList.remove('show', 'animate-in');
					downloadBtn.style.display = 'none';
				} else {
					// 迟一点再显示下载按钮，避免和刚出现的预览同时弹出
					setTimeout(() => {
						downloadBtn.style.display = 'flex';
						downloadBtn.classList.add('show');
						downloadBtn.disabled = false;
						// 添加进入动画
						setTimeout(() => {
							downloadBtn.classList.add('animate-in');
						}, 50);
						// 清理动画类
						setTimeout(() => {
							downloadBtn.classList.remove('animate-in');
						}, 550);
					}, 200);
				}
			}
		} else if (transfer.status === 'failed') {
			// 传输层拒发后停在这里：进度条保留已经发出的比例，状态文字说明传输中断，
			// 不能让它看起来还在继续发。
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = t('file.transfer_stopped', 'Transfer stopped');
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		}
	});
}

// Handle incoming file messages
// 处理接收到的文件消息
export function handleFileMessage(message, isPrivate = false) {
	const { type, fileId, userName } = message;
	
	switch (type) {
		case 'file_start':
			handleFileStart(message, isPrivate);
			break;
		case 'file_volume':
			handleFileVolume(message);
			break;
		case 'file_complete':
			handleFileComplete(message);
			break;
	}
}

// Handle file start message
// 处理文件开始消息
function handleFileStart(message, isPrivate) {
	const { fileId, fileName, originalSize, compressedSize, totalVolumes, originalHash, userName, isArchive } = message;

	// 旧版本客户端把多选文件打成一个自定义格式的归档，新版既不再生成也不再解开它。
	// 与其给一张点开是坏文件的卡片，不如直接说明收不了。
	if (isArchive) {
		if (window.addSystemMsg) {
			window.addSystemMsg(t('file.legacy_archive', 'A device running an older version sent a multi-file archive, which this version cannot open. Ask them to send the files one by one.'));
		}
		return;
	}
	
	const fileTransfer = {
		fileId,
		fileName,
		originalSize,
		compressedSize,
		totalVolumes,
		receivedVolumes: new Set(),
		volumeData: new Array(totalVolumes),
		status: 'receiving',
		originalHash,
		userName // 记录发送者名字
	};
	
	window.fileTransfers.set(fileId, fileTransfer);
	
	// 添加文件消息到聊天
	if (window.addOtherMsg) {
		const displayData = {
			type: 'file',
			fileId,
			fileName,
			originalSize,
			totalVolumes,
			userName
		};
		
		window.addOtherMsg(displayData, userName, userName, false, isPrivate ? 'file_private' : 'file');
	}
}

// Handle file volume message
// 处理文件分卷消息
function handleFileVolume(message) {
	const { fileId, volumeIndex, volumeData } = message;
	const transfer = window.fileTransfers.get(fileId);
	
	if (!transfer) return;
	
	transfer.receivedVolumes.add(volumeIndex);
	transfer.volumeData[volumeIndex] = volumeData;
	
	updateFileProgress(fileId);
}

// Handle file complete message
// 处理文件完成消息
function handleFileComplete(message) {
	const { fileId } = message;
	const transfer = window.fileTransfers.get(fileId);
	
	if (!transfer) return;
	
	// 检查是否所有分卷都已接收
	if (transfer.receivedVolumes.size === transfer.totalVolumes) {
		transfer.status = 'completed';
		updateFileProgress(fileId);
	}
}

// Get preview bytes for a file message
// 取一条文件消息用于预览的字节
//
// 为什么不能像别处那样“发个请求去取”：NodeCrypt 的文件是设备之间点对点传的，字节只
// 存在于接收方攒下的分卷或发送方手里的原始 File 上，没有任何服务端地址能按需取回。
// 两个来源都没有时（传输结束后的历史消息、发送方刷新后的旧卡片）只能返回 null，
// 由调用方保持原状，不做半截预览。
export async function getPreviewBlob(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer) return null;
	// File 本身就是 Blob，直接交给预览，省掉一次解压。
	if (transfer.sourceFile) return transfer.sourceFile;
	if (Array.isArray(transfer.volumeData) && transfer.volumeData.length > 0) {
		const bytes = await decompressVolumesToBytes(transfer.volumeData, transfer.originalHash);
		return new Blob([bytes]);
	}
	return null;
}

// Mount previews for every file card under the given root
// 为给定根节点下的所有文件卡挂载预览
// 可以在消息插入后重复调用：已经挂过的卡片会被跳过，所以收到新分卷时再调一次也不会重来。
export function mountFilePreviews(root) {
	const scope = root || document;
	const slots = scope.querySelectorAll('.file-preview-slot');
	slots.forEach((slot) => {
		if (slot.dataset.previewState && slot.dataset.previewState !== 'idle') return;
		const card = slot.closest('[data-file-id]');
		if (!card) return;
		const fileId = card.dataset.fileId;
		const transfer = window.fileTransfers.get(fileId);
		// 只有字节齐了才预览：传输中挂上去只会显示“加载中”，随后还得再拆掉。
		if (!transfer || transfer.status !== 'completed') return;

		slot.dataset.previewState = 'pending';
		window.dispatchEvent(new CustomEvent('filePreviewMount', { detail: { fileId } }));

		getPreviewBlob(fileId)
			.then((blob) => {
				if (!blob) {
					// 拿不到字节就彻底不动这个位置，让卡片维持原样（只有下载入口）。
					slot.dataset.previewState = 'idle';
					return;
				}
				return mountFilePreview(slot, {
					blob,
					fileName: transfer.fileName,
					fileId,
					// 发送方没有分卷可下载，导航上不给一个点了没反应的按钮。
					canDownload: Array.isArray(transfer.volumeData) && transfer.volumeData.length > 0
				});
			})
			.catch((error) => {
				console.error('File preview error:', error);
				slot.dataset.previewState = 'failed';
				slot.textContent = `${t('preview.unavailable', 'Preview unavailable')}: ${error.message}`;
			});
	});
}

// Download file from volumes
// 从分卷下载文件
export async function downloadFile(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer || transfer.status !== 'completed') return;
	
	try {
		await decompressVolumesToFile(transfer.volumeData, transfer.fileName, transfer.originalHash);
	} catch (error) {
		console.error('Download error:', error);
		window.addSystemMsg(`Failed to download: ${error.message}`);
	}
}

// Format file size
// 格式化文件大小
export function formatFileSize(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}