import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentProofUploadFailedMessage,
  normalizePaymentProofError,
  isSupportedImageType,
  normalizeImageType,
} from './payment-proof-utils.js';

test('normalizes legacy payment screenshot read failures to the friendly upload message', () => {
  assert.equal(normalizePaymentProofError('Payment screenshot could not be read.'), paymentProofUploadFailedMessage);
  assert.equal(normalizePaymentProofError('The payment screenshot could not be read.'), paymentProofUploadFailedMessage);
  assert.equal(normalizePaymentProofError('Payment proof upload failed. Please try again.'), paymentProofUploadFailedMessage);
});

test('accepts the common screenshot MIME types used by browsers and normalizes mobile camera formats', () => {
  assert.equal(isSupportedImageType('image/jpeg'), true);
  assert.equal(isSupportedImageType('image/jpg'), true);
  assert.equal(isSupportedImageType('image/png'), true);
  assert.equal(isSupportedImageType('image/webp'), true);
  assert.equal(isSupportedImageType('image/heic'), true);
  assert.equal(isSupportedImageType('image/heif'), true);
  assert.equal(normalizeImageType('image/heic'), 'image/jpeg');
  assert.equal(normalizeImageType('image/heif'), 'image/jpeg');
  assert.equal(isSupportedImageType('image/svg+xml'), false);
});
