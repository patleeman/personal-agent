export function resolveSpaIndexRelativePath(pathname: string): 'index.html' | 'app/index.html' {
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return 'app/index.html';
  }

  return 'index.html';
}
