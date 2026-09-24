const adminMethodEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const adminMethodToast = message => {
  const box = document.querySelector('#toast');
  if (!box) return;
  box.textContent = message;
  box.classList.add('show');
};
const adminMethodApi = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update payment methods.');
  return data;
};
const paymentMethodSection = () => [...document.querySelectorAll('.admin-section')].find(section => section.querySelector('h2')?.textContent.trim() === 'Payment Methods');
const renderPaymentMethods = async section => {
  const data = await adminMethodApi('/admin/payment-methods');
  section.dataset.methodsManaged = 'true';
  section.innerHTML = `<h2>Payment Methods</h2><form class="card admin-form" data-admin-method-form="new"><input name="name" placeholder="Wallet name" required><input name="details" placeholder="Payment number / instructions" required><button class="primary">Add method</button></form><div class="admin-method-list">${data.methods.map(method => `<form class="card admin-method-row" data-admin-method-form="edit" data-id="${method.id}"><div><strong>${adminMethodEsc(method.name)}</strong><span class="method-state">${method.enabled ? 'Enabled' : 'Disabled'}</span></div><input name="details" value="${adminMethodEsc(method.details)}" aria-label="${adminMethodEsc(method.name)} payment number or instructions" required><button type="submit">Save</button><button type="button" data-method-action="toggle" data-id="${method.id}" data-enabled="${method.enabled}">${method.enabled ? 'Disable' : 'Enable'}</button><button type="button" data-method-action="delete" data-id="${method.id}">Delete</button></form>`).join('')}</div>`;
};
const managePaymentMethods = async () => {
  const section = paymentMethodSection();
  if (!section || section.dataset.methodsManaged === 'true') return;
  try { await renderPaymentMethods(section); } catch { section.removeAttribute('data-methods-managed'); }
};
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-admin-method-form]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.adminMethodForm === 'new') await adminMethodApi('/admin/payment-methods', { method: 'POST', body: JSON.stringify(data) });
    else await adminMethodApi(`/admin/payment-methods/${form.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ details: data.details }) });
    await renderPaymentMethods(form.closest('.admin-section'));
    adminMethodToast('Payment method saved.');
  } catch (error) { adminMethodToast(error.message); }
}, true);
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-method-action]');
  if (!button) return;
  event.preventDefault();
  const section = button.closest('.admin-section');
  try {
    const path = `/admin/payment-methods/${button.dataset.id}`;
    if (button.dataset.methodAction === 'toggle') await adminMethodApi(path, { method: 'PATCH', body: JSON.stringify({ enabled: button.dataset.enabled !== 'true' }) });
    else await adminMethodApi(path, { method: 'DELETE' });
    await renderPaymentMethods(section);
    adminMethodToast('Payment method updated.');
  } catch (error) { adminMethodToast(error.message); }
});
new MutationObserver(managePaymentMethods).observe(document.querySelector('#app'), { childList: true, subtree: true });
managePaymentMethods();