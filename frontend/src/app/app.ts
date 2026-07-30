import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LoadingBarComponent } from './shared/components/loading-bar/loading-bar.component';

/**
 * Root component.
 *
 * Deliberately minimal: it renders the router outlet and the global progress
 * bar, and nothing else. Page chrome belongs to the layouts in `layouts/`, which
 * are themselves routed — so this component never needs to know whether the user
 * is signed in.
 */
@Component({
  selector: 'pb-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, LoadingBarComponent],
  template: `
    <pb-loading-bar />
    <router-outlet />
  `,
})
export class App {}
