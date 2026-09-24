document.addEventListener('click', event => {
  const button = event.target.closest('[data-action="copy-ref"]');
  if (!button) return;
  const code = document.querySelector('input[name="referralCode"]')?.value;
  if (!code) return;
  const link = `${window.location.origin}/register?ref=${encodeURIComponent(code)}`;
  navigator.clipboard?.writeText(link).catch(() => {});
}, true);