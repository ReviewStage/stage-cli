// Stage CLI runs without auth, so all view-state rows are owned by a single sentinel user.
// Multi-user comes with auth (post-V1); when that lands, this constant goes away and userId
// becomes a real foreign key. Until then, every API path treats the local user as implicit
// and never exposes this value in URLs.
export const LOCAL_USER_ID = "local";
