import type { ObservationState } from './letterboxdObservations';
import type { WriteIntent } from './letterboxdWriteQueue';

// Retire work, not evidence: keep failed results intact for diagnosis, never
// manufacture a successful observation that a future write could use.
export function retireCompletedObservations(state: ObservationState, intents: WriteIntent[], now = Date.now()) {
  for (const r of state.requests) {
    if (r.retired || !r.owners?.length) continue;
    const completed = r.owners.every(owner => intents.some(i =>
      i.userId === r.userId && i.account === r.account && i.film === r.film &&
      i.state === 'verified' && Number.isFinite(i.verifiedAt) &&
      i.created >= r.requestedAt && i.verifiedAt! <= now &&
      (r.entryId === undefined || r.entryId === i.entryId) &&
      owner === `${owner.startsWith('playback:') ? 'playback' : 'review'}:${i.originEntityId}`
    ));
    if (completed) r.retired = { at: now, reason: 'owning-publication-verified' };
  }
}

export function retireConsolidatedPlaybackObservations(
  state: ObservationState,
  reviews: {id:string;userId:number;viewingEventId:string|null;externalEntryId:string|null;watchedDate:string|null;rating:number|null;text:string;spoiler:boolean}[],
  receipts: import('./letterboxdSyncReceipts').SyncReceipt[], now=Date.now()
) {
  for (const r of state.requests) {
    if(r.retired || !r.owners?.length) continue;
    const consolidated=r.owners.every(owner => owner.startsWith('playback:') && reviews.some(local =>
      local.userId===r.userId && `playback:${local.viewingEventId}`===owner &&
      !!local.externalEntryId &&
      (local.externalEntryId===`https://letterboxd.com/${r.account}/film/${r.film}/` ||
       new RegExp(`^https://letterboxd\\.com/${r.account}/film/${r.film}/[0-9]+/$`).test(local.externalEntryId)) &&
      (!r.entryId || r.entryId===local.externalEntryId) && !r.createNew &&
      receipts.some(receipt=>receipt.userId===r.userId && receipt.account===r.account &&
        receipt.originId===local.id && receipt.entryId===local.externalEntryId &&
        receipt.boundDiaryOriginId && receipt.baseline?.rating===local.rating &&
        receipt.baseline?.text===local.text && receipt.baseline?.spoiler===local.spoiler &&
        receipts.some(diary=>diary.userId===r.userId && diary.account===r.account &&
          diary.originId===receipt.boundDiaryOriginId && diary.entryId===receipt.entryId &&
          diary.diaryBaseline?.watchedDate===local.watchedDate && !!diary.verifiedAt))
    ));
    if(consolidated)r.retired={at:now,reason:'playback-consolidated-with-verified-diary'};
  }
}
