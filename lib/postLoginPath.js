/**
 * Where /enterprise/login sends someone after sign-in. Everyone, owners
 * included, lands on All Documents; owners reach Owner Usage from the sidebar.
 */

export function getPostLoginPath() {
  return '/enterprise/documents';
}
