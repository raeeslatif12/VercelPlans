const paymentProofUploadFailedMessage = 'Payment proof upload failed. Please try again.';

const normalizeImageType = fileType => {
  const normalized = String(fileType || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/heic' || normalized === 'image/heif') return 'image/jpeg';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(normalized)) return normalized;
  return '';
};

const inferImageTypeFromName = fileName => {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (['heic', 'heif'].includes(ext)) return 'image/jpeg';
  return '';
};

const normalizePaymentProofError = message => {
  const normalized = String(message || '');
  return [
    'Payment screenshot could not be read.',
    'The payment screenshot could not be read.',
    paymentProofUploadFailedMessage,
  ].includes(normalized)
    ? paymentProofUploadFailedMessage
    : normalized;
};

const isSupportedImageType = fileType => Boolean(normalizeImageType(fileType) || inferImageTypeFromName(fileType));

const checkoutToast = message => {
  const box = document.querySelector('#toast');
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
};

const imageDataUrl = file => new Promise(async (resolve, reject) => {
  try {
    if (!file) return reject(new Error('Please select a payment screenshot.'));
    const detectedType = normalizeImageType(file.type) || inferImageTypeFromName(file.name);
    if (!detectedType) return reject(new Error('Please upload a JPG, PNG, WEBP, HEIC, or HEIF image.'));
    const sourceType = detectedType === 'image/png' ? 'image/png' : 'image/jpeg';
    const fileHasMobileFormat = /(heic|heif)/i.test(String(file.type || file.name || ''));
    const sourceDataUrl = await new Promise((readResolve, readReject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || '');
        if (!/^data:image\//i.test(value)) return readReject(new Error('Payment screenshot could not be read.'));
        readResolve(value);
      };
      reader.onerror = () => readReject(new Error('Payment screenshot could not be read.'));
      reader.readAsDataURL(file);
    });
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxSide = 2048;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Payment screenshot could not be read.');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.9;
        let dataUrl = canvas.toDataURL(sourceType, quality);
        let atobSize = () => {
          try { return atob(dataUrl.split(',')[1] || '').length; } catch { return dataUrl.length; }
        };
        while (atobSize() > 5 * 1024 * 1024 && quality > 0.35) {
          quality *= 0.7;
          dataUrl = canvas.toDataURL(sourceType, quality);
        }
        if (atobSize() > 5 * 1024 * 1024) {
          throw new Error('Payment proof must be 5 MB or smaller.');
        }
        resolve(dataUrl);
      } catch (error) {
        reject(new Error(error.message || paymentProofUploadFailedMessage));
      }
    };
    img.onerror = () => reject(new Error('Payment screenshot could not be read.'));
    img.src = sourceDataUrl;
  } catch (error) {
    reject(error);
  }
});

let selectedPaymentProofFile = null;
document.addEventListener('change', event => {
  const input = event.target.closest('input[name="paymentProof"]');
  if (!input) return;
  const file = input.files && input.files[0];
  selectedPaymentProofFile = file || null;
  const form = input.closest('form');
  const nameNode = form?.querySelector('[data-payment-proof-name]');
  const previewNode = form?.querySelector('[data-payment-proof-preview]');
  if (file) {
    if (nameNode) nameNode.textContent = file.name;
    if (previewNode && previewNode.querySelector('img')) {
      const reader = new FileReader();
      reader.onload = () => {
        previewNode.hidden = false;
        previewNode.querySelector('img').src = String(reader.result);
      };
      reader.onerror = () => {
        previewNode.hidden = true;
      };
      reader.readAsDataURL(file);
    }
  } else if (nameNode) {
    nameNode.textContent = 'No file selected';
    if (previewNode) previewNode.hidden = true;
  }
});

document.addEventListener('click', event => {
  const method = event.target.closest('[data-payment-id]');
  if (!method) return;
  const instructions = document.querySelector('[data-payment-instructions]');
  if (instructions) instructions.textContent = method.dataset.paymentDetails || 'Payment instructions are not configured yet.';
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.dataset.form !== 'order') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const file = selectedPaymentProofFile || form.querySelector('input[name="paymentProof"]')?.files[0];
  if (!file) return checkoutToast('Please upload your payment screenshot.');
  try {
    const data = Object.fromEntries(new FormData(form));
    data.paymentProof = await imageDataUrl(file);
    data.paymentMethodId = form.querySelector('[data-payment-id].selected')?.dataset.paymentId;
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not submit the order.');
    window.history.pushState({}, '', '/orders');
    window.location.reload();
  } catch (error) {
    checkoutToast(normalizePaymentProofError(error.message));
  }
}, true);