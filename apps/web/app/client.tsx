import { StartClient } from '@tanstack/react-start';
import { hydrateRoot } from 'react-dom/client';
import { queryClient } from './queryClient';
import { createRouter } from './router';

const router = createRouter({ queryClient });

hydrateRoot(document, <StartClient router={router} />);
