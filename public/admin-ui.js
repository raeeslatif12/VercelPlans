const adminUiEsc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const adminUiApi = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update the order.');
  return data;
};
const adminUiToast = message => {
  const toast = document.querySelector('#toast');
  if (toast) { toast.textContent = message; toast.classList.add('show'); }
};
const ordersSection = () => [...document.querySelectorAll('.admin-section')].find(section => section.querySelector('h2')?.textContent.trim() === 'Orders');
const usersSection = () => document.querySelector('.admin-users-section');
const showAdminSidebar = () => {
  if (document.querySelector('.admin-sidebar')) return;
  const app = document.querySelector('#app');
  if (!app) return;
  app.insertAdjacentHTML('afterbegin', '<aside class="admin-sidebar"><strong>Admin Panel</strong><a href="#admin-overview">Overview</a><a href="#admin-users">Users</a><a href="#admin-plans">Plans</a><a href="#admin-orders">Orders</a><a href="#admin-withdrawals">Withdrawals</a><a href="#admin-payments">Payment Methods</a></aside>');
  [...document.querySelectorAll('.admin-section')].forEach(section => {
    const title = section.querySelector('h2')?.textContent.trim();
    const id = title === 'Plans' ? 'admin-plans' : title === 'Orders' ? 'admin-orders' : title === 'Withdrawals' ? 'admin-withdrawals' : title === 'Payment Methods' ? 'admin-payments' : '';
    if (id) section.id = id;
  });
  document.querySelector('.page-heading')?.setAttribute('id', 'admin-overview');
};
const renderUsers = async section => {
  const data = await adminUiApi('/admin/users');
  section.dataset.usersManaged = 'true';
  section.innerHTML = `<h2>Users</h2><div class="admin-user-list">${data.users.map(user => `<form class="card admin-user-row" data-admin-user="${user.id}"><div><strong>User #${user.id} · ${adminUiEsc(user.phone)}</strong><span>${adminUiEsc(user.role)} · Joined ${new Date(user.created_at).toLocaleDateString()}</span><span>Reviews ${user.total_reviews} · Referrals ${user.total_referrals} · Referral earnings PKR ${Number(user.referral_earnings || 0).toLocaleString()}</span></div><label>Balance<input name="balance" type="number" min="0" step="1" value="${Number(user.balance || 0)}"></label><button type="submit">Save balance</button></form>`).join('')}</div>`;
};
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
  if (!document.querySelector('.page-heading h1')?.textContent.includes('Admin dashboard')) return;
  showAdminSidebar();
  const orderSection = ordersSection();
  if (orderSection && orderSection.dataset.ordersManaged !== 'true') {
    try { await renderOrders(orderSection); } catch { orderSection.removeAttribute('data-orders-managed'); }
  }
  if (orderSection && !usersSection()) {
    orderSection.insertAdjacentHTML('beforebegin', '<section class="admin-section admin-users-section" id="admin-users"></section>');
  }
  const userSection = usersSection();
  if (userSection && userSection.dataset.usersManaged !== 'true') {
    try { await renderUsers(userSection); } catch { userSection.removeAttribute('data-users-managed'); }
  }
};
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-admin-user]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try { await adminUiApi(`/admin/users/${form.dataset.adminUser}`, { method: 'PATCH', body: JSON.stringify({ balance: Number(data.balance) }) }); await renderUsers(form.closest('.admin-users-section')); } catch (error) { adminUiToast(error.message); }
}, true);
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