import { describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_MEDIA_MAX_BYTES,
  outboundMessageMediaPath,
  resolveMessageMedia,
  validateMessageImage,
} from './message-media.js';

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const REF = `upr-storage://message-attachments/outbound/${CONVERSATION}/photo.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);

describe('private message media', () => {
  it.each([
    ['image/jpeg', JPEG, 'jpg'],
    ['image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'],
    ['image/gif', new TextEncoder().encode('GIF89a'), 'gif'],
  ])('accepts verified %s bytes', (mimeType, bytes, extension) => {
    expect(validateMessageImage(bytes, mimeType)).toMatchObject({
      mimeType,
      byteSize: bytes.byteLength,
      extension,
    });
  });

  it('rejects unsupported, oversized, and disguised media', () => {
    expect(() => validateMessageImage(JPEG, 'application/pdf'))
      .toThrowError(expect.objectContaining({ code: 'MESSAGE_MEDIA_TYPE_UNSUPPORTED' }));
    expect(() => validateMessageImage(new Uint8Array(MESSAGE_MEDIA_MAX_BYTES + 1), 'image/jpeg'))
      .toThrowError(expect.objectContaining({ code: 'MESSAGE_MEDIA_SIZE_UNSUPPORTED' }));
    expect(() => validateMessageImage(new TextEncoder().encode('<html>'), 'image/jpeg'))
      .toThrowError(expect.objectContaining({ code: 'MESSAGE_MEDIA_SIGNATURE_INVALID' }));
  });

  it('binds outbound references to the requested conversation', () => {
    expect(outboundMessageMediaPath(REF, CONVERSATION))
      .toBe(`outbound/${CONVERSATION}/photo.jpg`);
    expect(outboundMessageMediaPath(REF, '22222222-2222-4222-8222-222222222222'))
      .toBeNull();
    expect(outboundMessageMediaPath(
      'upr-storage://message-attachments/outbound/../secret.jpg',
      CONVERSATION,
    )).toBeNull();
  });

  it('downloads and revalidates private media before provider dispatch', async () => {
    const db = {
      downloadStorage: vi.fn(async () => ({
        bytes: JPEG,
        contentType: 'image/jpeg',
      })),
    };
    const [media] = await resolveMessageMedia(db, [REF], CONVERSATION);
    expect(db.downloadStorage).toHaveBeenCalledWith(
      'message-attachments',
      `outbound/${CONVERSATION}/photo.jpg`,
      MESSAGE_MEDIA_MAX_BYTES,
    );
    expect(media).toMatchObject({
      storageRef: REF,
      mimeType: 'image/jpeg',
      byteSize: JPEG.byteLength,
    });
  });

  it('fails closed on multiple images and foreign opaque references', async () => {
    await expect(resolveMessageMedia({}, [REF, REF], CONVERSATION))
      .rejects.toMatchObject({ code: 'MESSAGE_MEDIA_COUNT_UNSUPPORTED' });
    await expect(resolveMessageMedia(
      {},
      ['upr-storage://message-attachments/callrail/provider/photo.jpg'],
      CONVERSATION,
    )).rejects.toMatchObject({ code: 'MESSAGE_MEDIA_REFERENCE_INVALID' });
  });

  it('rejects arbitrary HTTPS and narrowly revalidates the old UPR public path for Twilio', async () => {
    await expect(resolveMessageMedia(
      {},
      ['https://attacker.test/photo.jpg'],
      CONVERSATION,
      { allowLegacyPublic: true, legacyPublicBaseUrl: 'https://db.test' },
    )).rejects.toMatchObject({ code: 'MESSAGE_MEDIA_REFERENCE_INVALID' });

    const db = {
      downloadStorage: vi.fn(async () => ({
        bytes: JPEG,
        contentType: 'image/jpeg',
      })),
    };
    const legacy =
      `https://db.test/storage/v1/object/public/job-files/conversations/${CONVERSATION}/photo.jpg`;
    const [media] = await resolveMessageMedia(
      db,
      [legacy],
      CONVERSATION,
      { allowLegacyPublic: true, legacyPublicBaseUrl: 'https://db.test' },
    );
    expect(db.downloadStorage).toHaveBeenCalledWith(
      'job-files',
      `conversations/${CONVERSATION}/photo.jpg`,
      MESSAGE_MEDIA_MAX_BYTES,
    );
    expect(media).toMatchObject({
      url: legacy,
      legacyPublic: true,
      verified: true,
      mimeType: 'image/jpeg',
    });
  });
});
