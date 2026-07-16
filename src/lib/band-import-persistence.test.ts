import { describe, expect, it, vi } from 'vitest';
import { persistBandImportedProduct } from './band-import-persistence';

const input = {
  internalCode: 'PUS-BAND-OSA-0001',
  displayName: '오사카 Band 상품',
  departureRegion: '부산',
  supplierCode: 'BAND',
  departureDate: null,
  netPrice: 10000,
  marginRate: 0.1,
  aiTags: ['band'],
  sourceFilename: 'band_rss_auto',
  postUrl: 'https://example.com/post',
  postTitle: 'Band post',
  rawText: 'safe excerpt',
};

describe('Band import persistence', () => {
  it('uses one atomic RPC with an explicit products internal code', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: input.internalCode, error: null });
    await expect(persistBandImportedProduct(input, { rpc })).resolves.toBe(input.internalCode);
    expect(rpc).toHaveBeenCalledWith('import_band_product_atomically', expect.objectContaining({
      p_product: expect.objectContaining({ internal_code: input.internalCode, net_price: 10000 }),
      p_log: expect.objectContaining({ post_url: input.postUrl }),
    }));
  });

  it('propagates an audit transaction failure to the caller', async () => {
    const error = { code: '23505', message: 'audit conflict' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    await expect(persistBandImportedProduct(input, { rpc })).rejects.toBe(error);
  });
});
