export const paymentProofUploadFailedMessage = 'Payment proof upload failed. Please try again.';

export const normalizeImageType = value => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/heic' || normalized === 'image/heif') return 'image/jpeg';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(normalized)) return normalized;
  return '';
};

export const normalizePaymentProofError = errorMessage => {
  const normalized = String(errorMessage || '');
  return [
    'Payment screenshot could not be read.',
    'The payment screenshot could not be read.',
    paymentProofUploadFailedMessage,
  ].includes(normalized)
    ? paymentProofUploadFailedMessage
    : normalized;
};

export const isSupportedImageType = fileType => Boolean(normalizeImageType(fileType));
