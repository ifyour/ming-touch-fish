import { createIsomorphicFn } from '@tanstack/react-start';

export const getApiUrl = createIsomorphicFn()
  .server(async (path: string) => {
    const { getRequestURL } = await import('@tanstack/react-start/server');
    return new URL(path, getRequestURL().origin).toString();
  })
  .client((path: string) => path);
