export function go(path, replace = false) {
  const url = `#/${path}`;
  if (replace) window.location.replace(url);
  else window.location.hash = url;
}
