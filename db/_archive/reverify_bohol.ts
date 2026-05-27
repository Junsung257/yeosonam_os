import { runUploadVerify } from '../src/lib/upload-verify';

const ids = ['e740822c-df2b-4a58-83de-ea07cc94e23b', '3646b8bb-9c5f-4a9f-bf11-999ea0c42a32'];

(async () => {
  for (const id of ids) {
    const r = await runUploadVerify(id);
    const c1 = r?.checks?.find((c) => c.id === 'C1');
    console.log(id, r?.status, c1?.detail ?? 'no result');
  }
})();
