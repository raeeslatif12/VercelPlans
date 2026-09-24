const adminUiEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const adminUiApi = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update the order.');
  return data;
};
const ordersSection = () => [...document.querySelectorAll('.admin-section')].find(section => section.querySelector('h2')?.textContent.trim() === 'Orders');
const proofMarkup = proof => {
  if (!proof) return '<span>Not provided</span>';
  if (String(proof).startsWith('data:image/')) return `<a class="proof-preview" href="${adminUiEsc(proof)}" target="_blank" rel="noopener"><img src="${adminUiEsc(proof)}" alt="Payment screenshot"></a>`;
  return `<a href="${adminUiEsc(proof)}" target="_blank" rel="noopener">View payment proof</a>`;
};
const renderOrders = async section => {
  const data = await adminUiApi('/admin/orders');
  section.dataset.ordersManaged = 'true';
  section.innerHTML = `<h2>Orders</h2><div class="admin-order-list">${data.orders.length ? data.orders.map(order => `<article class="card admin-order-row"><div class="admin-order-user"><strong>Order #${order.id} · ${adminUiEsc(order.plan_name)}</strong><span>User #${order.user_id} · ${adminUiEsc(order.phone)}</span><span>Account created ${new Date(order.user_created_at).toLocaleDateString()} · Balance ${adminUiEsc(order.user_balance)}</span><span>${adminUiEsc(order.payment_method || 'Payment method unavailable')} · PKR ${Number(order.investment || 0).toLocaleString()}</span><small>Transaction UID: ${adminUiEsc(order.payment_reference || 'Not provided')}<br>Sender Number: ${adminUiEsc(order.payment_details || 'Not provided')}<br>Proof: ${proofMarkup(order.payment_proof)}</small></div><select data-admin-order-status="${order.id}">${['Pending','Approved','Rejected','Processing','Completed'].map(status => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select><button type="button" data-admin-order-save="${order.id}">Save</button></article>`).join('') : '<div class="empty"><strong>No orders yet</strong></div>'}</div>`;
};
const setAdminMode = () => {
  const admin = document.querySelector('.page-heading h1')?.textContent.trim() === 'Admin dashboard';
  document.querySelector('#app')?.classList.toggle('admin-mode', admin);
  if (admin) document.querySelector('.profile-menu')?.remove();
};
const manageAdminUi = async () => {
  setAdminMode();
  const section = ordersSection();
  if (!section || section.dataset.ordersManaged === 'true') return;
  try { await renderOrders(section); } catch { section.removeAttribute('data-orders-managed'); }
};
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-admin-order-save]');
  if (!button) return;
  try {
    await adminUiApi(`/admin/orders/${button.dataset.adminOrderSave}`, { method: 'PATCH', body: JSON.stringify({ status: document.querySelector(`[data-admin-order-status="${button.dataset.adminOrderSave}"]`).value }) });
    await renderOrders(button.closest('.admin-section'));
  } catch (error) {
    const toast = document.querySelector('#toast');
    if (toast) { toast.textContent = error.message; toast.classList.add('show'); }
  }
});
new MutationObserver(manageAdminUi).observe(document.querySelector('#app'), { childList: true, subtree: true });
manageAdminUi();