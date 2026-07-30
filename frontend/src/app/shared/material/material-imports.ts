import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Curated Material import groups.
 *
 * Standalone components import Material modules individually, which is what
 * makes tree-shaking work — but repeating eight imports on every form component
 * is noise. These arrays are a middle ground: import one group instead of a
 * barrel, and keep the bundle honest.
 *
 * Deliberately NOT a single `MaterialModule` re-exporting everything. That is
 * the classic mistake: it pulls the entire library into every lazy chunk and
 * undoes the point of standalone components.
 *
 * Usage:
 * ```ts
 * @Component({ imports: [...MATERIAL_FORM_IMPORTS] })
 * ```
 */

/** Buttons, icons, tooltips — needed by almost every component. */
export const MATERIAL_CORE_IMPORTS = [MatButtonModule, MatIconModule, MatTooltipModule] as const;

/** Reactive form controls and their field chrome. */
export const MATERIAL_FORM_IMPORTS = [
  ...MATERIAL_CORE_IMPORTS,
  MatFormFieldModule,
  MatInputModule,
  MatSelectModule,
  MatCheckboxModule,
  MatSlideToggleModule,
  MatDatepickerModule,
] as const;

/** Sortable, paginated tables. */
export const MATERIAL_TABLE_IMPORTS = [
  ...MATERIAL_CORE_IMPORTS,
  MatTableModule,
  MatSortModule,
  MatPaginatorModule,
  MatChipsModule,
] as const;

/**
 * Application shell: toolbar, sidenav, navigation lists, menus.
 *
 * `MatBadgeModule` is deliberately absent. The notification bell was its only consumer and now
 * draws its own count — `matBadge` positions a filled disc from the host's box, which put it half
 * outside a 40px button and painted it in the theme's `warn`, i.e. the same red as a validation
 * error. Left in this list it would ship a module nothing imports.
 */
export const MATERIAL_LAYOUT_IMPORTS = [
  ...MATERIAL_CORE_IMPORTS,
  MatToolbarModule,
  MatSidenavModule,
  MatListModule,
  MatMenuModule,
  MatDividerModule,
] as const;

/** Dialogs, snackbars and progress indicators. */
export const MATERIAL_FEEDBACK_IMPORTS = [
  ...MATERIAL_CORE_IMPORTS,
  MatDialogModule,
  MatSnackBarModule,
  MatProgressBarModule,
  MatProgressSpinnerModule,
] as const;

/** Cards and tabbed content. */
export const MATERIAL_CONTENT_IMPORTS = [MatCardModule, MatTabsModule, MatDividerModule] as const;
