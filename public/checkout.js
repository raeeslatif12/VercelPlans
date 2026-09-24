const checkoutToast = message => {
  const box = document.querySelector('#toast');
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
};

const imageDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    image.onerror = () => reject(new Error('The payment screenshot could not be read.'));
    image.src = reader.result;
  };
  reader.onerror = () => reject(new Error('The payment screenshot could not be read.'));
  reader.readAsDataURL(file);
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
  const file = form.querySelector('input[name="paymentProof"]')?.files[0];
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
    checkoutToast(error.message);
  }
}, true);