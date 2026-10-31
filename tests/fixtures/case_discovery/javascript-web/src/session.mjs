export function signOut(store, response) {
  store.delete('session');
  response.clearCookie('sid', {httpOnly:true});
  return {status:204};
}
