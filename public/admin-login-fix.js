new MutationObserver(() => {
  const field = document.querySelector('[data-admin-login] input[name="email"]');
  if (field) field.type = 'text';
}).observe(document.querySelector('#app'), { childList: true, subtree: true });