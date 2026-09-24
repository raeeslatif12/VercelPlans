const referralToast = message => { const node = document.querySelector('#toast'); if (!node) return; node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2600); };
const copyReferralText = async text => {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  return copied;
};
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action="copy-link"],[data-action="copy-code"],[data-action="share-ref"]');
  if (!button) return;
  const code = document.querySelector('input[name="referralCode"]')?.value;
  const link = document.querySelector('input[name="inviteLink"]')?.value;
  try {
    if (button.dataset.action === 'share-ref' && navigator.share) {
      await navigator.share({ title: 'Join VercelPlans', text: `Use my referral code ${code} to join VercelPlans.`, url: link });
      referralToast('Invite shared.');
    } else {
      const copied = await copyReferralText(button.dataset.action === 'copy-code' ? code : link);
      referralToast(copied ? `${button.dataset.action === 'copy-code' ? 'Code' : 'Link'} copied.` : 'Copy is not available on this device.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') referralToast('Unable to share right now.');
  }
}, true);