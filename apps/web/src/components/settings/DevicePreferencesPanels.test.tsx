// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@timeblock/shared';
import { DEFAULT_UI_PREFERENCES } from '../../lib/uiPreferences.js';
import DevicePreferencesPanels from './DevicePreferencesPanels.js';

const emailStatus = vi.hoisted(() => ({
  data: {
    googleConnected: true,
    gmailPermissionGranted: true,
    encryptionConfigured: true,
    senderEmail: 'me@example.com',
    recipientEmail: 'me@example.com',
    lastDelivery: null as { status: string; error: string | null; at: string } | null,
    currentError: null as string | null,
  },
  isLoading: false,
}));
const mutate = vi.hoisted(() => vi.fn());

vi.mock('../../hooks.js', () => ({
  useEmailNotificationStatus: () => emailStatus,
  useSendTestEmail: () => ({ mutate, isPending: false, isSuccess: false, isError: false, error: null }),
}));
vi.mock('../../hooks/useTheme.js', () => ({ useTheme: () => ({ setting: 'system', resolved: 'light', setSetting: vi.fn() }) }));
vi.mock('../../lib/uiPreferences.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/uiPreferences.js')>('../../lib/uiPreferences.js');
  return { ...actual, useUiPreferences: () => ({ preferences: actual.DEFAULT_UI_PREFERENCES, updatePreferences: vi.fn(), resetPreferences: vi.fn() }) };
});
vi.mock('../../lib/attentionAlerts.js', () => ({ enqueueAttentionAlert: vi.fn() }));
vi.mock('../../lib/sound.js', () => ({ primeAlarmAudio: vi.fn(async () => undefined) }));

describe('email notification settings UI', () => {
  afterEach(() => { cleanup(); mutate.mockClear(); emailStatus.data.currentError = null; emailStatus.data.lastDelivery = null; });

  it('shows the connected sender/recipient and exposes all controls', async () => {
    const onChange = vi.fn();
    render(<DevicePreferencesPanels isVisible={(id) => id === 'notifications'} serverSettings={{ ...DEFAULT_SETTINGS, emailNotificationsEnabled: true }} onServerSettingChange={onChange} />);

    expect(screen.getByText(/Gmail send permission granted for me@example.com/)).toBeTruthy();
    expect(screen.getAllByLabelText('Send at')).toHaveLength(2);
    expect(screen.getByLabelText('Minutes before')).toHaveProperty('value', '30');
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    expect(mutate).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable email' }));
    expect(onChange).toHaveBeenCalledWith('emailNotificationsEnabled', false);
  });

  it('renders authorization remediation clearly', () => {
    emailStatus.data.currentError = 'Reconnect Gmail in Settings.';
    render(<DevicePreferencesPanels isVisible={(id) => id === 'notifications'} serverSettings={DEFAULT_SETTINGS} onServerSettingChange={vi.fn()} />);
    expect(screen.getByText('Reconnect Gmail in Settings.')).toBeTruthy();
  });

  it('keeps a failed delivery visible after a server restart', () => {
    emailStatus.data.lastDelivery = { status: 'failed', error: 'Enable the Gmail API for this Google Cloud project.', at: '2026-09-10T17:03:45.713Z' };
    render(<DevicePreferencesPanels isVisible={(id) => id === 'notifications'} serverSettings={DEFAULT_SETTINGS} onServerSettingChange={vi.fn()} />);
    expect(screen.getByText('Enable the Gmail API for this Google Cloud project.')).toBeTruthy();
  });
});
