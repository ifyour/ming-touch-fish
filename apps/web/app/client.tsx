import { StartClient } from '@tanstack/react-start';
import { hydrateRoot } from 'react-dom/client';
import { createRouter } from './router';
import { queryClient } from './queryClient';

const router = createRouter({ queryClient });

hydrateRoot(document, <StartClient router={router} />);
