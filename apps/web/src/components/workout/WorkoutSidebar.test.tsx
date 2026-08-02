// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkoutSidebar from './WorkoutSidebar.js';

describe('WorkoutSidebar', () => {
  afterEach(cleanup);

  it('renders every native workout workspace section', () => {
    const { container } = render(<WorkoutSidebar view="overview" onChange={() => undefined} />);
    const html = container.innerHTML;
    for (const label of ['Overview', 'Strength', 'Powerlifting', 'Body map', 'Calendar', 'Records', 'Goals', 'Coaching tools', 'Settings']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Volume &amp; recovery');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('<select');
    expect(html).toContain('Workout section');
  });

  it('changes sections from the compact native selector', () => {
    const onChange = vi.fn();
    render(<WorkoutSidebar view="overview" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Workout section'), { target: { value: 'strength' } });
    expect(onChange).toHaveBeenCalledWith('strength');
  });
});
