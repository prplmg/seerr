// Date-only diary chronology must agree with the date shown on review cards.
// Undated reviews retain their publication day; imports/edits do not move a watch.
export const reviewActivityDate = "COALESCE(NULLIF(review.watchedDate, ''), SUBSTR(review.publishedAt, 1, 10))";
