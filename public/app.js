const app = document.querySelector('#app');
const toast = message => { const box = document.querySelector('#toast'); if (!box) return; box.textContent = message; box.classList.add('show'); setTimeout(() => box.classList.remove('show'), 2600); };
const api = async (path, options = {}) => { const response = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...options }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Something went wrong.'); return data; };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const money = value => `PKR ${Number(value || 0).toLocaleString()}`;
const formatNotificationDate = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};
const formatWithdrawalApprovalDate = value => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const notificationReasonLabel = source => ({ referral_reward:'Referral reward', daily_task_reward:'Daily task reward', daily_plan_profit:'Plan earning', account_creation_reward:'Account creation reward', admin_adjustment:'Balance credit' }[source] || 'Balance credit');
let currentNotifications = [];
let notificationPollTimer = null;
let notificationOwnerId = null;
const knownNotificationIds = new Set();
const markNotificationPopupSeen = notificationId => api(`/notifications/${notificationId}/popup-seen`, { method: 'PATCH' }).catch(() => null);
const showEarningNotification = notification => {
  if (!notification || Number(notification.amount || 0) <= 0) return;
  const root = document.querySelector('#earnings-toast-root');
  if (!root) return;
  const card = document.createElement('div');
  card.className = 'earning-toast';
  card.innerHTML = `
    <button class="earning-toast-close" type="button" data-action="dismiss-earning-toast" aria-label="Dismiss notification">×</button>
    <div class="earning-toast-icon" aria-hidden="true">✓</div>
    <div class="earning-toast-copy">
      <div class="earning-toast-kicker">Congratulations!</div>
      <div class="earning-toast-amount">+ ${money(notification.amount)}</div>
      <div class="earning-toast-message">${esc(notification.message || `${notificationReasonLabel(notification.source)} credited successfully.`)}</div>
      <div class="earning-toast-meta"><span>${esc(notification.reason || notificationReasonLabel(notification.source))}</span><span>${esc(formatNotificationDate(notification.createdAt || notification.created_at || new Date()))}</span></div>
    </div>
  `;
  root.appendChild(card);
  if (notification.id) {
    knownNotificationIds.add(Number(notification.id));
    markNotificationPopupSeen(notification.id);
  }
  requestAnimationFrame(() => card.classList.add('show'));
  const timeout = setTimeout(() => {
    card.classList.add('hide');
    setTimeout(() => card.remove(), 220);
  }, 4200);
  card.querySelector('[data-action="dismiss-earning-toast"]')?.addEventListener('click', () => {
    clearTimeout(timeout);
    card.classList.add('hide');
    setTimeout(() => card.remove(), 220);
  });
};
const loadNotifications = async ({ showNew = false } = {}) => {
  try {
    const data = await api('/notifications');
    currentNotifications = Array.isArray(data.notifications) ? data.notifications : [];
    if (showNew) currentNotifications.filter(item => item.status === 'unread' && !item.popupSeenAt && !knownNotificationIds.has(Number(item.id))).forEach(showEarningNotification);
    if (!notificationPollTimer) notificationPollTimer = setInterval(() => loadNotifications({ showNew: true }), 10000);
    return currentNotifications;
  } catch (error) {
    currentNotifications = [];
    return currentNotifications;
  }
};
const loadingView = (kind = 'page') => `<main class="loading-view loading-${kind}" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><div class="loading-copy"><strong>${kind === 'admin' ? 'Preparing your workspace' : 'Preparing your view'}</strong><span>Just a moment</span></div></main>`;
const mark = text => `<span class="brand-dot">${esc(String(text).slice(0, 2).toUpperCase())}</span>`;
const displayName = user => String(user?.fullName || user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.phone || (user?.id ? `User #${user.id}` : 'Account')).trim();
const avatarInitials = user => String(user?.avatarInitials || displayName(user).split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2) || 'VP').toUpperCase();
const input = (label, name, placeholder, type = 'text', required = false) => `<div class="field"><label>${label}</label><input name="${name}" type="${type}" placeholder="${placeholder}"${required ? ' required' : ''}></div>`;
const navIcon = name => ({
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V19h14V9.5"/><path d="M9 19v-6h6v6"/></svg>',
  plans: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5h10l2 4v9.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5l2-4Z"/><path d="M9 10h6M9 14h6"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5v5M8.5 6.5l3.5 3.5 3.5-3.5"/><circle cx="12" cy="14" r="6"/><path d="M12 10v4l2.5 2"/></svg>',
  refer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h10v10H7z"/><path d="M10 14 17 7"/><path d="M14 7h3v3"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5h16v9H4z"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
}[name] || '');
const header = auth => auth ? `<header class="app-header"><button class="menu-button" aria-label="Open menu">☰</button><a class="brand" href="/dashboard"><span class="brand-mark">V</span>VercelPlans</a><nav class="app-nav"><div class="nav-links"><a href="/dashboard">Dashboard</a><a href="/plans">Plans</a><a href="/orders">My Orders</a><a href="/tasks">Daily Task</a><a href="/refer">Refer & Earn</a><a href="/notifications">Notifications</a><a href="/withdraw">Withdraw</a></div></nav><div class="profile-menu"><button class="profile-avatar" aria-label="Open profile menu">${avatarInitials(currentUser)}</button><div class="profile-dropdown"><strong class="profile-dropdown-name">${esc(displayName(currentUser))}</strong><a href="/profile">Profile</a><a href="/history">History</a><a href="/notifications">Notifications</a><a href="#logout" data-action="logout">Log out</a></div></div></header>` : `<header class="site-header"><a class="brand" href="/"><span class="brand-mark">V</span>VercelPlans</a><nav class="top-links"><a href="/login">Login</a><a href="/register">Join Free</a></nav></header>`;
const bottom = path => {
  const items = [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/plans', label: 'Plans', icon: 'plans' },
    { href: '/orders', label: 'My Orders', icon: 'orders' },
    { href: '/tasks', label: 'Daily Task', icon: 'tasks' },
    { href: '/refer', label: 'Refer & Earn', icon: 'refer' },
    { href: '/withdraw', label: 'Withdraw', icon: 'withdraw' },
  ];
  const mainItems = items.slice(0, 3);
  const menuItems = items.slice(3);
  return `<nav class="dashboard-nav" aria-label="Primary navigation">${mainItems.map(item => `<a class="dashboard-nav-item ${path === item.href ? 'active' : ''}" href="${item.href}" aria-current="${path === item.href ? 'page' : 'false'}"><span class="dashboard-nav-icon">${navIcon(item.icon)}</span><span>${item.label}</span></a>`).join('')}${menuItems.length ? `<button class="dashboard-nav-menu-toggle" type="button" data-action="toggle-bottom-nav-menu" aria-label="Open more navigation" aria-expanded="false" aria-controls="bottom-nav-menu"><span class="dashboard-nav-icon">${navIcon('menu')}</span><span>More</span></button><div class="dashboard-nav-menu" id="bottom-nav-menu" hidden role="menu" aria-label="More navigation">${menuItems.map(item => `<a class="dashboard-nav-menu-item ${path === item.href ? 'active' : ''}" href="${item.href}" role="menuitem" aria-current="${path === item.href ? 'page' : 'false'}"><span class="dashboard-nav-icon">${navIcon(item.icon)}</span><span>${item.label}</span></a>`).join('')}</div>` : ''}</nav>`;
};
const shell = (body, path) => `${header(true)}<main class="app-main">${body}</main>${bottom(path)}`;
const publicPage = () => `${header(false)}<main class="public-main"><section class="hero"><div class="eyebrow"><i></i> Trusted by reviewers across Pakistan</div><h1>Rate the brands you love.<span>Get paid in rupees.</span></h1><p>Give a 5-star rating to 10 leading apps every day and earn <strong>PKR 350</strong>. Invite friends and collect <strong>PKR 80</strong> per referral. Cash out straight to your local wallet.</p><div class="hero-actions"><a href="/register">Create your account <span>→</span></a><a href="/login">I already have an account</a></div></section><section class="brand-loop"><p class="brand-loop-label">Featured brands on the platform</p><div class="brand-list">${['Daraz','Coca-Cola','Pepsi','Audionic','Foodpanda','Careem','Easypaisa','JazzCash','Samsung','Khaadi','Nestle','Bykea','Shan Foods','Infinix','Sapphire','Gul Ahmed'].map(name => `<span class="brand-item">${mark(name)}${name}</span>`).join('')}</div></section><section class="benefits"><article class="benefit"><div class="benefit-icon">✦</div><h2>Daily 5-star task</h2><p>Rate 10 verified brand apps each day. Finish all 10 and PKR 350 lands in your balance instantly.</p></article><article class="benefit"><div class="benefit-icon">↗</div><h2>Referral rewards</h2><p>Every friend who joins with your unique link earns you PKR 80, credited the moment they register.</p></article><article class="benefit"><div class="benefit-icon">▣</div><h2>Local wallet payouts</h2><p>Withdraw to Easypaisa, JazzCash, SadaPay or NayaPay directly from your dashboard.</p></article></section><section class="feature-section"><h2>Brands featured in today's task</h2><p class="section-copy">A curated mix of Pakistan's biggest names and global favourites.</p><div class="feature-grid">${['Daraz','Coca-Cola','Pepsi','Audionic','Foodpanda','Careem','Easypaisa','JazzCash'].map(name => `<div class="feature-card">${mark(name)}${name}</div>`).join('')}</div></section><section class="start"><div><h2>Start earning today</h2><ul><li>Free to join</li><li>No hidden charges</li><li>Payouts to Pakistani wallets</li></ul></div><a href="/register">Register now</a></section></main><footer class="footer">© 2026 VercelPlans. Made for Pakistan.</footer>`;
const authPage = register => `<main class="auth-page"><div class="auth-wrap"><a class="brand auth-brand" href="/"><span class="brand-mark">V</span>VercelPlans</a><form class="auth-card" data-form="${register ? 'register' : 'login'}"><h1>${register ? 'Create your account' : 'Welcome back'}</h1><p>${register ? 'Register with your mobile number and start earning today.' : 'Log in with your mobile number to continue.'}</p>${register ? `${input('First Name','firstName','Your first name','text',true)}${input('Last Name','lastName','Your last name','text',true)}` : ''}${input('Mobile Number','phone','03XX XXXXXXX')}${input('Password','password',register ? 'At least 7 characters' : 'Enter your password','password')}${register ? `${input('Confirm Password','confirmPassword','Re-enter your password','password')}${input('Referral Code','referralCode','e.g. 8F2A19C4')}` : ''}<button class="primary" type="submit">${register ? 'Create account' : 'Login'}</button></form><div class="auth-foot">${register ? 'Already registered? ' : 'New to VercelPlans? '}<a href="/${register ? 'login' : 'register'}">${register ? 'Login here' : 'Create an account'}</a></div></div></main>`;
const dashboard = data => {
  const user = data?.user || data || {};
  const activePlans = Array.isArray(data?.activePlans) ? data.activePlans : [];
  const pendingOrder = data?.pendingOrder || null;

  const planCards = activePlans.length
    ? activePlans.map(plan => {
        const progress = Math.max(0, Math.min(100, Number(plan.progress_percent || 0)));
        const statusClass = plan.status === 'Active' ? 'success' : 'muted';
        return `
          <div class="card active-plan-card">
            <div class="plan-card-head">
              <div>
                <div class="eyebrow">Active Plan</div>
                <h3>${esc(plan.name)}</h3>
              </div>
              <span class="plan-status-badge ${statusClass}">${esc(plan.status)}</span>
            </div>
            <div class="plan-metrics-grid">
              <div><span>Investment</span><strong>${money(plan.investment)}</strong></div>
              <div><span>Daily Profit</span><strong>${money(plan.daily_profit)}</strong></div>
              <div><span>Earned So Far</span><strong>${money(plan.total_earned)}</strong></div>
              <div><span>Expected Return</span><strong>${money(plan.total_return)}</strong></div>
            </div>
            <div class="plan-progress-wrap">
              <div class="plan-progress-meta"><span>Progress</span><strong>${plan.days_completed}/${plan.duration_days} days</strong></div>
              <div class="progress-track"><span style="width:${progress}%"></span></div>
            </div>
            <div class="plan-footer-meta">
              <span>Start: <strong>${new Date(plan.start_date).toLocaleDateString()}</strong></span>
              <span>End: <strong>${new Date(plan.end_date).toLocaleDateString()}</strong></span>
              <span>Remaining: <strong>${plan.days_remaining} days</strong></span>
            </div>
          </div>
        `;
      }).join('')
    : pendingOrder
      ? `
        <div class="card plan-empty-card">
          <div class="eyebrow">Plan Status</div>
          <h3>Approval Pending</h3>
          <p>Your ${esc(pendingOrder.plan_name)} order is currently ${esc(pendingOrder.status)}. It will become active after approval.</p>
          <div class="plan-inline-meta"><span>Investment</span><strong>${money(pendingOrder.investment)}</strong></div>
          <a class="primary" href="/orders">View orders →</a>
        </div>
      `
      : `
        <div class="card plan-empty-card">
          <div class="eyebrow">No Active Plan</div>
          <h3>No active plan yet</h3>
          <p>Choose a plan to begin earning from your investment portfolio.</p>
          <a class="primary" href="/plans">Buy a plan →</a>
        </div>
      `;

  return shell(`
    <section class="balance-card">
      <div>
        <div class="balance-label">Available balance</div>
        <div class="balance">${money(user.balance)}</div>
      </div>
      <a href="/withdraw">Withdraw funds →</a>
    </section>
    <section class="stats">
      <div class="card stat"><strong>${user.totalReviews}</strong><span>Total Reviews Completed</span></div>
      <div class="card stat"><strong>${money(user.referralEarnings)}</strong><span>Total Referral Earnings</span></div>
      <div class="card stat"><strong>${user.totalReferrals}</strong><span>Total Referrals</span></div>
    </section>
    <section class="dashboard-quick-links" aria-label="Quick actions">
      <a class="card quick-link" href="/tasks"><span class="quick-link-icon">★</span><span><strong>Daily rating tasks</strong><small>Complete today's activity</small></span><span class="quick-link-arrow">→</span></a>
      <a class="card quick-link" href="/refer"><span class="quick-link-icon">↗</span><span><strong>Refer & earn</strong><small>Invite friends and track rewards</small></span><span class="quick-link-arrow">→</span></a>
      <a class="card quick-link" href="/history"><span class="quick-link-icon">↺</span><span><strong>Withdrawal history</strong><small>Review your payout activity</small></span><span class="quick-link-arrow">→</span></a>
    </section>
    <div class="page-heading">
      <h1>Welcome back, ${esc(displayName(user))}!</h1>
      <p>Your VercelPlans earning overview.</p>
    </div>
    <div class="active-plan-section">
      <div class="active-plan-header"><h2>Active plan</h2><a href="/plans">View plans</a></div>
      <div class="active-plan-list">${planCards}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <strong>Explore investment plans</strong>
      <p class="section-copy">Choose a plan and track your order from one place.</p>
      <a href="/plans">View Plans →</a>
    </div>
  `, '/dashboard');
};
const tasks = data => {
  if (!data.enabled) {
    return shell('<div class="page-heading"><h1>Daily rating task</h1><p>Daily tasks are currently unavailable.</p></div><div class="card empty"><strong>Tasks are disabled</strong><p class="section-copy">Please check back later for the next available task cycle.</p></div>', '/tasks');
  }
  if (!data.tasks?.length) {
    return shell('<div class="page-heading"><h1>Daily rating task</h1><p>Today\'s tasks could not be prepared.</p></div><div class="card empty"><strong>No tasks available</strong><p class="section-copy">Please refresh in a moment or contact support if this continues.</p></div>', '/tasks');
  }
  const progressPercent = Math.round((data.progress / data.taskCount) * 100);
  return shell(`<div class="page-heading"><h1>Daily rating task</h1><p>Rate each app below to complete today\'s ${data.taskCount} tasks.</p></div><div class="card task-summary"><div class="task-summary-row"><span>Today\'s progress</span><strong>${data.progress}/${data.taskCount}</strong></div><div class="progress"><i style="width:${progressPercent}%"></i></div>${data.completed ? '<div class="notice">✓ All tasks complete. Your daily reward has been credited.</div>' : '<p class="task-reward-note">Complete all tasks to earn the configured daily reward.</p>'}</div><div class="task-list" style="margin-top:16px">${data.tasks.map(task => `<article class="card task-card ${task.completed ? 'is-complete' : ''}">${mark(task.task_name)}<div class="task-copy"><h2>${esc(task.task_name)}</h2><p>${esc(task.category)}</p></div><div class="task-action"><span class="task-reward">${money(task.reward_amount)}</span>${task.completed ? '<span class="task-status">Rated</span>' : `<button class="rate-button" data-action="rate-task" data-task-id="${task.id}">Rate</button>`}</div></article>`).join('')}</div>`, '/tasks');
};
const inviteLink = user => { const url = new URL('/register', window.location.origin); url.searchParams.set('ref', user.referralCode); return url.toString(); };
const refer = ({ user, referrals }) => { const link = inviteLink(user); const approved = Number(referrals.approved || 0); const pending = Number(referrals.pending || 0); return shell(`<div class="page-heading"><span class="eyebrow">Community rewards</span><h1>Refer & earn</h1><p>Share your personal link and earn when an invited user's first plan order is approved.</p></div><section class="stats referral-stats"><div class="card stat"><strong>${Number(referrals.total || 0)}</strong><span>Total referrals</span></div><div class="card stat"><strong>${approved}</strong><span>Approved referrals</span></div><div class="card stat"><strong>${pending}</strong><span>Pending referrals</span></div><div class="card stat"><strong>${money(referrals.earnings)}</strong><span>Referral earnings</span></div></section><div class="referral-layout"><section class="card referral-card"><div class="section-kicker">Your invite kit</div><h2>Invite someone you trust</h2><p class="section-copy">Your code stays the same permanently. Rewards are recorded after approval in Neon.</p><div class="field"><label>Your referral code</label><input name="referralCode" readonly value="${esc(user.referralCode)}"></div><div class="field"><label>Your invite link</label><input name="inviteLink" readonly value="${esc(link)}"></div><div class="referral-actions"><button class="primary" type="button" data-action="copy-link">▣ Copy Link</button><button class="secondary" type="button" data-action="copy-code">▣ Copy Code</button><button class="secondary" type="button" data-action="share-ref">↗ Share</button></div></section><section class="card referral-activity"><div class="section-kicker">Activity</div><h2>Referral activity</h2>${referrals.referrals?.length ? `<div class="activity-list">${referrals.referrals.map(item => `<div class="activity-row"><span class="activity-avatar">${esc(String(item.referred_phone).slice(-2))}</span><div><strong>${esc(item.referred_phone)}</strong><small>${item.status === 'registered' ? 'Waiting for first approved plan' : `Approved ${new Date(item.qualified_at || item.created_at).toLocaleDateString()}`}</small></div><span class="status-pill ${item.status === 'registered' ? 'pending' : 'success'}">${item.status === 'registered' ? 'Pending' : 'Approved'}</span></div>`).join('')}</div>` : '<div class="empty-state"><strong>No referrals yet</strong><span>Your referral activity will appear here.</span></div>'}</section></div>`, '/refer'); };
const withdraw = (user, config = {}) => { const minimum = Number(config.minimumWithdrawalAmount ?? user.minimumWithdrawalAmount ?? 0); const availableBalance = Number(user.balance || 0); return shell(`<div class="page-heading"><span class="eyebrow">Payout center</span><h1>Withdraw</h1><p>Move available earnings to your preferred local wallet.</p></div><section class="balance-card withdraw-balance"><div><div class="balance-label">Available balance</div><div class="balance" data-available-balance="${availableBalance}">${money(availableBalance)}</div></div><a href="/history">View history →</a></section><div class="notice withdraw-requirements"><strong>Before you request a payout</strong><span>Minimum withdrawal is ${money(minimum)} and an approved active plan is required.</span></div><div class="withdraw-balance-panel" aria-live="polite"><div class="withdraw-balance-row"><span>Available balance</span><strong>${money(availableBalance)}</strong></div><div class="withdraw-balance-preview" data-withdraw-preview>Remaining balance: ${money(availableBalance)}</div></div><form class="card form-card" data-form="withdraw"><div class="field"><label>Select wallet</label><div class="choice-row">${['Easypaisa','JazzCash','SadaPay','NayaPay'].map((wallet,index) => `<button type="button" class="wallet ${index === 0 ? 'selected' : ''}" data-wallet="${wallet}">${wallet}</button>`).join('')}</div></div>${input('Account number','accountNumber','03XX XXXXXXX')}${input('Account holder name','accountHolder','As registered on the wallet')}<div class="field"><label>Withdrawal amount (PKR)</label><input name="amount" type="number" min="0" step="0.01" placeholder="Minimum ${minimum}" data-withdraw-amount aria-describedby="withdraw-amount-preview"></div><button class="primary" type="submit" ${user.balance < minimum ? 'disabled' : ''}>${user.balance < minimum ? `Minimum balance ${money(minimum)}` : 'Request withdrawal'}</button></form>`, '/withdraw'); };
const plansPage = plans => shell(`<div class="page-heading"><span class="eyebrow">Investment catalog</span><h1>Plans</h1><p>Compare the available plans and choose the one that fits your goals.</p></div><div class="feature-grid">${plans.map(plan => `<article class="card plan-card"><div class="plan-card-top"><div class="eyebrow">${plan.duration_days} day plan</div><span class="status-pill ${plan.active === false ? 'pending' : 'success'}">${plan.active === false ? 'Unavailable' : 'Available'}</span></div><h2>${esc(plan.name)}</h2><strong class="plan-price">${money(plan.investment)}</strong><p class="section-copy">${esc(plan.description)}</p><div class="plan-meta"><span>Daily return<strong>${money(plan.daily_return)}</strong></span><span>Projected total<strong>${money(plan.total_return)}</strong></span></div><a class="primary" href="/plans/${plan.id}" ${plan.active === false ? 'aria-disabled="true"' : ''}>${plan.active === false ? 'Unavailable' : 'Buy Plan'}</a></article>`).join('')}</div>`, '/plans');
const planDetails = data => { const p = data.plan; const firstMethod = data.paymentMethods[0]; return shell(`<div class="page-heading"><a href="/plans">← Back to Plans</a><h1>${esc(p.name)}</h1><p>${esc(p.description)}</p></div><div class="card form-card"><div class="plan-meta"><span>Investment<strong>${money(p.investment)}</strong></span><span>Duration<strong>${p.duration_days} days</strong></span><span>Daily return<strong>${money(p.daily_return)}</strong></span><span>Total return<strong>${money(p.total_return)}</strong></span></div><form data-form="order"><input type="hidden" name="planId" value="${p.id}"><div class="field"><label>Payment Method</label><div class="choice-row">${data.paymentMethods.map((m,index) => `<button type="button" class="wallet ${index === 0 ? 'selected' : ''}" data-payment-id="${m.id}" data-payment-details="${esc(m.details)}">${esc(m.name)}</button>`).join('')}</div><div class="payment-instructions"><strong>Payment number / instructions</strong><span data-payment-instructions>${esc(firstMethod?.details || 'Payment instructions are not configured yet.')}</span></div></div>${input('Transaction UID','paymentReference','Enter the transaction UID')}${input('Sender Number','paymentDetails','Your wallet or bank number')}${`<div class="field"><label>Payment Screenshot</label><input name="paymentProof" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" required><div class="payment-proof-meta" data-payment-proof-name>No file selected</div><div class="payment-proof-preview" hidden data-payment-proof-preview><img alt="Selected payment screenshot preview"></div><small>Upload a screenshot showing the completed payment.</small></div>`}<button class="primary" type="submit">Submit Order</button></form></div>`, `/plans/${p.id}`); };
const ordersPage = orders => shell(`<div class="page-heading"><span class="eyebrow">Account activity</span><h1>My Orders</h1><p>Track every plan purchase, payment and current status.</p></div><div class="card table-card">${orders.length ? `<table class="table"><thead><tr><th>Order</th><th>Plan</th><th>Investment</th><th>Payment</th><th>Date</th><th>Status</th></tr></thead><tbody>${orders.map(o => `<tr><td data-label="Order">#${o.id}</td><td data-label="Plan">${esc(o.plan_name)}</td><td data-label="Investment">${money(o.investment)}</td><td data-label="Payment">${esc(o.payment_method || 'Not provided')}</td><td data-label="Date">${new Date(o.created_at).toLocaleDateString()}</td><td data-label="Status"><span class="status-pill ${String(o.status).toLowerCase()}">${esc(o.status)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><strong>No orders yet</strong><span>Choose a plan to create your first order.</span><a class="primary" href="/plans">Browse plans</a></div>'}</div>`, '/orders');
const historyPage = rows => shell(`<div class="page-heading"><span class="eyebrow">Payout activity</span><h1>Withdrawal history</h1><p>Review the date, amount and status of every payout request.</p></div><div class="card table-card">${rows.length ? `<div class="table-scroll"><table class="table withdrawal-table"><thead><tr><th>Date & Time</th><th>Wallet</th><th>Account</th><th>Amount</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows.map(row => {
  const status = String(row.status || 'Pending');
  const statusClass = ['approved', 'completed', 'success'].includes(status.toLowerCase()) ? 'success' : ['rejected', 'failed', 'cancelled'].includes(status.toLowerCase()) ? 'danger' : ['processing'].includes(status.toLowerCase()) ? 'processing' : 'pending';
  const account = [row.account_number || '', row.account_holder || ''].filter(Boolean).join(' / ') || '—';
  const notes = row.rejection_reason || (row.approved_at ? 'Approved' : 'Awaiting review');
  return `<tr><td data-label="Date & Time">${new Date(row.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td><td data-label="Wallet">${esc(row.wallet || '—')}</td><td data-label="Account">${esc(account)}</td><td data-label="Amount">${money(row.amount)}</td><td data-label="Status"><span class="status-pill ${statusClass}">${esc(status)}</span></td><td data-label="Notes">${esc(notes)}</td></tr>`;
}).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No withdrawals yet</strong><span>Your payout history will appear here.</span><a class="primary" href="/withdraw">Make a withdrawal</a></div>'}</div>`, '/history');
const notificationsPage = rows => shell(`<div class="page-heading"><span class="eyebrow">Account updates</span><h1>Notifications</h1><p>Track your latest earning credits and important account activity.</p></div><div class="card notification-center">${rows.length ? rows.map(item => `<article class="notification-row ${item.status === 'unread' ? 'is-unread' : ''}"><div class="notification-icon">${item.status === 'unread' ? '✦' : '✓'}</div><div class="notification-content"><div class="notification-title-row"><strong>${esc(item.title || 'Congratulations!')}</strong>${item.status === 'unread' ? '<span class="notification-badge">New</span>' : '<span class="notification-badge muted">Read</span>'}</div><div class="notification-amount">${money(item.amount || 0)}</div><p>${esc(item.message || `${notificationReasonLabel(item.source)} credited successfully.`)}</p><div class="notification-meta"><span>${esc(item.reason || notificationReasonLabel(item.source))}</span><span>${esc(formatNotificationDate(item.createdAt || item.created_at))}</span></div></div><div class="notification-actions"><button class="secondary" type="button" data-action="mark-notification-read" data-notification-id="${item.id}" ${item.status === 'read' ? 'disabled' : ''}>${item.status === 'read' ? 'Read' : 'Mark read'}</button><button class="close-chip" type="button" aria-label="Dismiss notification" data-action="dismiss-notification" data-notification-id="${item.id}">×</button></div></article>`).join('') : '<div class="empty-state"><strong>No notifications yet</strong><span>Your earning updates will appear here.</span></div>'}</div>`, '/notifications');
const profile = user => shell(`<div class="page-heading"><span class="eyebrow">Account settings</span><h1>My profile</h1><p>Manage your account details and password settings.</p></div><div class="card profile-summary"><div class="profile-summary-avatar">${esc(avatarInitials(user))}</div><div><strong>${esc(displayName(user))}</strong><span>${esc(user.phone)}${user.email ? ` · ${esc(user.email)}` : ''}</span></div><a class="secondary" href="/refer">Refer & earn</a></div><form class="card form-card" data-form="profile-email"><h2>Email address</h2><div class="field"><label>Email</label><input name="email" type="email" placeholder="Optional email address" value="${esc(user.email || '')}"></div><button class="primary" type="submit">${user.email ? 'Update email' : 'Add email'}</button>${user.email ? '<button class="secondary" type="button" data-action="remove-email">Remove email</button>' : ''}</form><form class="card form-card" data-form="password"><h2>Change password</h2>${input('New Password','password','At least 7 characters','password')}${input('Confirm Password','confirmPassword','Re-enter the new password','password')}<button class="primary" type="submit">Update password</button></form>`, '/profile');
const adminPage = data => shell(`<div class="page-heading"><h1>Admin dashboard</h1><p>Manage plans, orders, withdrawals, and payment methods.</p></div><section class="admin-section"><h2>Settings</h2><form class="card admin-form" data-form="admin-settings"><input name="referral_reward_amount" value="${Number(data.settings?.referral_reward_amount ?? 80)}" type="number" placeholder="Referral reward amount"><label><input type="checkbox" name="referral_system_enabled" ${data.settings?.referral_system_enabled ? 'checked' : ''}> Referral system enabled</label><input name="minimum_withdrawal_amount" value="${Number(data.settings?.minimum_withdrawal_amount ?? 500)}" type="number" placeholder="Minimum withdrawal amount"><label><input type="checkbox" name="withdrawal_system_enabled" ${data.settings?.withdrawal_system_enabled ? 'checked' : ''}> Withdrawal system enabled</label><input name="daily_task_count" value="${Number(data.settings?.daily_task_count ?? 10)}" type="number" placeholder="Daily task count"><input name="daily_task_reward_amount" value="${Number(data.settings?.daily_task_reward_amount ?? 20)}" type="number" placeholder="Reward per task"><label><input type="checkbox" name="daily_tasks_enabled" ${data.settings?.daily_tasks_enabled ? 'checked' : ''}> Daily tasks enabled</label><label><input type="checkbox" name="device_restriction_enabled" ${data.settings?.device_restriction_enabled ? 'checked' : ''}> One account per device</label><label><input type="checkbox" name="allow_multiple_accounts_per_device" ${data.settings?.allow_multiple_accounts_per_device ? 'checked' : ''}> Allow multiple accounts on this device (exception)</label><button class="primary">Save settings</button></form></section><section class="admin-section"><h2>Plans</h2><form class="card admin-form" data-form="admin-plan"><input name="name" placeholder="Plan name" required><input name="investment" type="number" placeholder="Investment" required><input name="dailyReturn" type="number" placeholder="Daily return" required><input name="durationDays" type="number" placeholder="Duration days" required><input name="totalReturn" type="number" placeholder="Total return" required><input name="description" placeholder="Description"><button class="primary">Create plan</button></form>${data.plans.map(p => `<div class="card admin-row"><div><strong>${esc(p.name)}</strong><span>${money(p.investment)} · ${p.active ? 'Active' : 'Inactive'}</span></div><button data-admin="toggle-plan" data-id="${p.id}" data-active="${p.active}">${p.active ? 'Deactivate' : 'Activate'}</button><button data-admin="delete-plan" data-id="${p.id}">Delete</button></div>`).join('')}</section><section class="admin-section"><h2>Orders</h2>${data.orders.map(o => `<div class="card admin-row"><div><strong>#${o.id} · ${esc(o.plan_name)}</strong><span>${esc(o.phone)} · ${money(o.investment)} · ${esc(o.payment_method || '')}</span><small>Proof: ${esc(o.payment_proof || 'Not provided')}<br>Reference: ${esc(o.payment_reference || 'Not provided')}</small></div><select data-order-status="${o.id}">${['Pending','Approved','Rejected','Processing','Completed'].map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button data-admin="save-order" data-id="${o.id}">Save</button></div>`).join('')}</section><section class="admin-section"><h2>Withdrawals</h2>${data.withdrawals.map(w => `<div class="card admin-row"><div><strong>#${w.id} · ${esc(w.phone)}</strong><span>${money(w.amount)} · ${esc(w.wallet)} · ${esc(w.account_number)}</span></div><select data-withdraw-status="${w.id}">${['Pending','Approved','Rejected','Processing','Completed'].map(s => `<option ${s === w.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button data-admin="save-withdrawal" data-id="${w.id}">Save</button></div>`).join('')}</section><section class="admin-section"><h2>Payment Methods</h2><form class="card admin-form" data-form="admin-payment"><input name="name" placeholder="Wallet name" required><input name="details" placeholder="Payment instructions" required><button class="primary">Add method</button></form>${data.methods.map(m => `<div class="card admin-row"><div><strong>${esc(m.name)}</strong><span>${m.enabled ? 'Enabled' : 'Disabled'} · ${esc(m.details)}</span></div><button data-admin="toggle-method" data-id="${m.id}" data-enabled="${m.enabled}">${m.enabled ? 'Disable' : 'Enable'}</button><button data-admin="delete-method" data-id="${m.id}">Delete</button></div>`).join('')}</section>`, '/admin');
const adminLoginPage = () => `<main class="auth-page admin-auth-page"><div class="auth-wrap"><div class="brand auth-brand"><span class="brand-mark">V</span>VercelPlans Admin</div><form class="auth-card" data-form="admin-login"><h1>Admin Login</h1><p>Sign in with your administrator credentials.</p>${input('Admin Email','email','admin email')} ${input('Admin Password','password','Enter admin password','password')}<button class="primary" type="submit">Login</button></form><div class="auth-foot"><a href="/">Return to VercelPlans</a></div></div></main>`;
const adminData = async () => ({ plans:(await api('/admin/plans')).plans, orders:(await api('/admin/orders')).orders, withdrawals:(await api('/admin/withdrawals')).withdrawals, methods:(await api('/admin/payment-methods')).methods, settings:(await api('/admin/settings')).settings });
let currentUser;
const render = async () => { const path = location.pathname; if (path === '/admin-dashboard') return; const privatePath = ['/dashboard','/tasks','/refer','/withdraw','/history','/profile','/plans','/orders','/notifications','/admin'].some(prefix => path.startsWith(prefix)); if (!privatePath) { app.innerHTML = path === '/login' ? authPage(false) : path === '/register' ? authPage(true) : publicPage(); bind(); return; } app.innerHTML = loadingView('page'); try { currentUser = (await api('/session')).user; if (notificationOwnerId !== currentUser.id) { notificationOwnerId = currentUser.id; knownNotificationIds.clear(); } const notifications = await loadNotifications({ showNew: path !== '/notifications' }); if (path === '/dashboard') { const dashboardData = await api('/dashboard'); app.innerHTML = dashboard(dashboardData); } else if (path === '/tasks') app.innerHTML = tasks(await api('/tasks')); else if (path === '/refer') { const referrals = await api('/referrals'); app.innerHTML = refer({ user: currentUser, referrals }); } else if (path === '/withdraw') app.innerHTML = withdraw(currentUser); else if (path === '/history') app.innerHTML = historyPage((await api('/withdrawals')).withdrawals); else if (path === '/notifications') app.innerHTML = notificationsPage(notifications); else if (path === '/profile') app.innerHTML = profile(currentUser); else if (path === '/plans') app.innerHTML = plansPage((await api('/plans')).plans); else if (path.startsWith('/plans/')) app.innerHTML = planDetails(await api(`/plans/${path.split('/')[2]}`)); else if (path === '/orders') app.innerHTML = ordersPage((await api('/orders')).orders); } catch (error) { window.history.pushState({}, '', '/login'); app.innerHTML = authPage(false); toast(error.message); } bind(); };
const bind = () => { document.querySelectorAll('a[href^="/"]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); window.history.pushState({}, '', link.getAttribute('href')); render(); })); document.querySelector('.menu-button')?.addEventListener('click', () => document.querySelector('.app-nav').classList.toggle('open')); document.querySelector('.profile-avatar')?.addEventListener('click', () => document.querySelector('.profile-menu').classList.toggle('open')); const withdrawAmountInput = document.querySelector('[data-withdraw-amount]'); const withdrawPreview = document.querySelector('[data-withdraw-preview]'); if (withdrawAmountInput && withdrawPreview) { const availableBalance = Number(document.querySelector('[data-available-balance]')?.dataset.availableBalance || currentUser?.balance || 0); const updateWithdrawPreview = () => { const rawValue = withdrawAmountInput.value; if (rawValue === '') { withdrawPreview.classList.remove('warning'); withdrawPreview.textContent = `Remaining balance: ${money(availableBalance)}`; return; } const amount = Number(rawValue); if (!Number.isFinite(amount) || amount < 0) { withdrawPreview.classList.add('warning'); withdrawPreview.textContent = 'Invalid amount'; return; } if (amount === 0) { withdrawPreview.classList.remove('warning'); withdrawPreview.textContent = `Remaining balance: ${money(availableBalance)}`; return; } if (amount > availableBalance) { withdrawPreview.classList.add('warning'); withdrawPreview.textContent = 'Insufficient balance'; return; } withdrawPreview.classList.remove('warning'); withdrawPreview.textContent = `Remaining balance: ${money(availableBalance - amount)}`; }; withdrawAmountInput.addEventListener('input', updateWithdrawPreview); withdrawAmountInput.addEventListener('change', updateWithdrawPreview); updateWithdrawPreview(); } document.querySelectorAll('[data-action="logout"]').forEach(btn => btn.addEventListener('click', async event => { event.preventDefault(); await api('/logout',{method:'POST'}); window.history.pushState({},'', '/'); render(); })); document.querySelectorAll('[data-action="rate-task"]').forEach(btn => btn.addEventListener('click', async () => { if (btn.disabled) return; btn.disabled = true; btn.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Rating</span>'; try { const result = await api(`/tasks/${btn.dataset.taskId}/complete`, { method:'POST' }); const card = btn.closest('.task-card'); const summary = document.querySelector('.task-summary'); const progressLabel = summary?.querySelector('.task-summary-row strong'); const progressBar = summary?.querySelector('.progress i'); const taskCount = Number(progressLabel?.textContent.split('/')[1] || 0); const progress = Number(result.progress || 0); btn.outerHTML = '<span class="task-status">Rated</span>'; card?.classList.add('is-complete'); if (progressLabel) progressLabel.textContent = `${progress}/${taskCount}`; if (progressBar && taskCount) progressBar.style.width = `${Math.round((progress / taskCount) * 100)}%`; if (result.completed) { summary?.querySelector('.task-reward-note')?.remove(); summary?.insertAdjacentHTML('beforeend', '<div class="notice">✓ All tasks complete. Your daily reward has been credited.</div>'); } if (result.notification) showEarningNotification(result.notification); if (result.reward) toast(`Daily reward credited: ${money(result.reward)}`); } catch (error) { btn.disabled = false; btn.textContent = 'Rate'; toast(error.message); } })); document.querySelector('[data-action="copy-ref"]')?.addEventListener('click', () => toast('Referral link copied.')); document.querySelectorAll('.wallet').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.wallet').forEach(item => item.classList.remove('selected')); btn.classList.add('selected'); })); document.querySelectorAll('[data-admin]').forEach(btn => btn.addEventListener('click', adminAction)); document.querySelectorAll('form').forEach(form => form.addEventListener('submit', submitForm)); };
const adminAction = async event => { const button = event.currentTarget; const id = button.dataset.id; try { if (button.dataset.admin === 'toggle-plan') await api(`/admin/plans/${id}`,{method:'PATCH',body:JSON.stringify({active:button.dataset.active !== 'true'})}); if (button.dataset.admin === 'delete-plan') await api(`/admin/plans/${id}`,{method:'DELETE'}); if (button.dataset.admin === 'toggle-method') await api(`/admin/payment-methods/${id}`,{method:'PATCH',body:JSON.stringify({enabled:button.dataset.enabled !== 'true'})}); if (button.dataset.admin === 'delete-method') await api(`/admin/payment-methods/${id}`,{method:'DELETE'}); if (button.dataset.admin === 'save-order') await api(`/admin/orders/${id}`,{method:'PATCH',body:JSON.stringify({status:document.querySelector(`[data-order-status="${id}"]`).value})}); if (button.dataset.admin === 'save-withdrawal') await api(`/admin/withdrawals/${id}`,{method:'PATCH',body:JSON.stringify({status:document.querySelector(`[data-withdraw-status="${id}"]`).value})}); toast('Admin change saved.'); renderAdmin(); } catch (error) { toast(error.message); } };
const submitForm = async event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); try { if (form.dataset.form === 'admin-login') { await api('/admin/login',{method:'POST',body:JSON.stringify(data)}); await renderAdmin(); return; } if (form.dataset.form === 'order') return; if (form.dataset.form === 'login') { await api('/login',{method:'POST',body:JSON.stringify(data)}); window.history.pushState({},'', '/dashboard'); } else if (form.dataset.form === 'register') { data.firstName = String(data.firstName || '').trim().replace(/\s+/g, ' '); data.lastName = String(data.lastName || '').trim().replace(/\s+/g, ' '); if (!data.firstName || !data.lastName) throw new Error('First name and last name are required.'); if (data.password !== data.confirmPassword) throw new Error('Passwords do not match.'); await api('/register',{method:'POST',body:JSON.stringify(data)}); window.history.pushState({},'', '/dashboard'); } else if (form.dataset.form === 'withdraw') { const availableBalance = Number(currentUser?.balance || 0); const amount = Number(data.amount); if (!Number.isFinite(amount) || amount <= 0) throw new Error('Please enter a valid withdrawal amount.'); if (amount > availableBalance) throw new Error('Insufficient balance.'); data.wallet = document.querySelector('.wallet.selected').dataset.wallet; data.amount = amount; await api('/withdrawals',{method:'POST',body:JSON.stringify(data)}); window.history.pushState({},'', '/history'); } else if (form.dataset.form === 'password') await api('/profile/password',{method:'POST',body:JSON.stringify(data)}); else if (form.dataset.form === 'order') { data.paymentMethodId = document.querySelector('[data-payment-id].selected').dataset.paymentId; await api('/orders',{method:'POST',body:JSON.stringify(data)}); window.history.pushState({},'', '/orders'); } else if (form.dataset.form === 'admin-plan') await api('/admin/plans',{method:'POST',body:JSON.stringify(data)}); else if (form.dataset.form === 'admin-payment') await api('/admin/payment-methods',{method:'POST',body:JSON.stringify(data)}); else if (form.dataset.form === 'admin-settings') { await api('/admin/settings',{method:'PUT',body:JSON.stringify({
      referral_reward_amount:Number(data.referral_reward_amount || 80),
      referral_system_enabled: !!data.referral_system_enabled,
      minimum_withdrawal_amount:Number(data.minimum_withdrawal_amount || 500),
      withdrawal_system_enabled: !!data.withdrawal_system_enabled,
      daily_task_count:Number(data.daily_task_count || 10),
      daily_task_reward_amount:Number(data.daily_task_reward_amount || 20),
      daily_tasks_enabled: !!data.daily_tasks_enabled,
      device_restriction_enabled: !!data.device_restriction_enabled,
      allow_multiple_accounts_per_device: !!data.allow_multiple_accounts_per_device,
    })}); } toast('Saved successfully.'); render(); } catch (error) { toast(error.message); } };
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
  const extension = String(fileName || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg'].includes(extension)) return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (['heic', 'heif'].includes(extension)) return 'image/jpeg';
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
const fileAsDataUrl = file => new Promise((resolve, reject) => {
  if (!file) return reject(new Error('Please select a payment screenshot.'));
  const detectedType = normalizeImageType(file.type) || inferImageTypeFromName(file.name);
  if (!detectedType) return reject(new Error('Please upload a JPG, PNG, WEBP, HEIC, or HEIF image.'));
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const maxSide = 2048;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Payment screenshot could not be read.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const outputType = detectedType === 'image/png' ? 'image/png' : 'image/jpeg';
      let quality = 0.92;
      let dataUrl = canvas.toDataURL(outputType, quality);
      const sizeInBytes = () => {
        try { return atob((dataUrl.split(',')[1] || '')).length; } catch { return dataUrl.length; }
      };
      while (sizeInBytes() > 5 * 1024 * 1024 && quality > 0.35) {
        quality *= 0.7;
        dataUrl = canvas.toDataURL(outputType, quality);
      }
      if (sizeInBytes() > 5 * 1024 * 1024) throw new Error('Payment proof must be 5 MB or smaller.');
      URL.revokeObjectURL(objectUrl);
      resolve(dataUrl);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(error.message || 'Payment screenshot could not be read.'));
    }
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('Payment screenshot could not be read.'));
  };
  image.src = objectUrl;
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
    if (previewNode) {
      const previewImg = previewNode.querySelector('img');
      const reader = new FileReader();
      reader.onload = () => {
        previewNode.hidden = false;
        if (previewImg) previewImg.src = String(reader.result);
      };
      reader.onerror = () => {
        previewNode.hidden = true;
      };
      reader.readAsDataURL(file);
    }
  } else {
    if (nameNode) nameNode.textContent = 'No file selected';
    if (previewNode) previewNode.hidden = true;
  }
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('form');
  if (!form || !['profile-email', 'order'].includes(form.dataset.form)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    if (form.dataset.form === 'profile-email') {
      await api('/profile', { method: 'PATCH', body: JSON.stringify({ email: form.elements.email.value }) });
      toast('Email saved.');
    } else {
      const file = selectedPaymentProofFile || form.elements.paymentProof.files[0];
      if (!file) throw new Error('Please select a payment screenshot.');
      const data = Object.fromEntries(new FormData(form));
      data.paymentMethodId = document.querySelector('[data-payment-id].selected').dataset.paymentId;
      data.paymentProof = await fileAsDataUrl(file);
      await api('/orders', { method: 'POST', body: JSON.stringify(data) });
      window.history.pushState({}, '', '/orders');
    }
    await render();
  } catch (error) {
    toast(normalizePaymentProofError(error.message));
  }
}, true);
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action="remove-email"]');
  if (!button) return;
  try {
    await api('/profile', { method: 'PATCH', body: JSON.stringify({ email: '' }) });
    await render();
    toast('Email removed.');
  } catch (error) {
    toast(error.message);
  }
});
const renderAdmin = async () => {};
const referralFromUrl = () => new URLSearchParams(location.search).get('ref')?.trim().toUpperCase() || '';
const fillReferralFromUrl = () => { const field = document.querySelector('input[name="referralCode"]'); const referral = referralFromUrl(); if (field && referral) { field.value = referral; field.readOnly = true; if (!field.closest('.field')?.querySelector('.referral-applied')) field.closest('.field')?.insertAdjacentHTML('afterbegin', `<div class="referral-applied">Referral code applied: <strong>${esc(referral)}</strong></div>`); } };
const preserveReferral = () => { const referral = referralFromUrl(); if (referral && location.pathname === '/register') history.replaceState({}, '', `/register?ref=${encodeURIComponent(referral)}`); };
const route = () => { if (location.pathname === '/admin') history.replaceState({}, '', '/admin-dashboard'); return location.pathname; };
window.addEventListener('popstate', () => { const path = route(); preserveReferral(); if (path !== '/admin-dashboard') render().then(fillReferralFromUrl); });
if (route() !== '/admin-dashboard') render().then(() => { preserveReferral(); fillReferralFromUrl(); });

