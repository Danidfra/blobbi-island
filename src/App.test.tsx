import { render } from '@testing-library/react';
import { test } from 'vitest';

import { flushProviderInit } from '@/test/flushProviderInit';
import App from './App';

test('App', async () => {
  render(<App />);
  await flushProviderInit();
});
