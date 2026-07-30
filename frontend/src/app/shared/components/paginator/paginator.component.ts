import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { PAGE_SIZE_OPTIONS } from '../../../core/constants/app.constants';
import type { PaginationMeta } from '../../../core/models/api-response.model';

/** What a consumer needs to fetch the requested page. 1-based, like the API. */
export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Pagination control.
 *
 * Wraps `MatPaginator` for one reason that matters: Material is **0-based**
 * (`pageIndex`) and the API is **1-based** (`page`). Translating at this single
 * boundary removes the off-by-one that otherwise appears in every list feature
 * that wires the two together by hand.
 *
 * Emits a request; it never paginates data itself. The dataset lives on the server,
 * so the parent refetches.
 */
@Component({
  selector: 'pb-paginator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatPaginatorModule],
  host: {
    class: 'block',
  },
  template: `
    <mat-paginator
      [length]="pagination().total"
      [pageSize]="pagination().pageSize"
      [pageIndex]="zeroBasedIndex()"
      [pageSizeOptions]="pageSizeOptions()"
      [showFirstLastButtons]="showFirstLast()"
      [hidePageSize]="hidePageSize()"
      [disabled]="disabled()"
      (page)="onPage($event)"
    />
  `,
})
export class PaginatorComponent {
  readonly pagination = input.required<PaginationMeta>();
  readonly pageSizeOptions = input<readonly number[]>(PAGE_SIZE_OPTIONS);
  readonly showFirstLast = input<boolean>(true);
  readonly hidePageSize = input<boolean>(false);
  readonly disabled = input<boolean>(false);

  readonly pageChange = output<PageRequest>();

  /** Clamped at 0 so a malformed `page: 0` cannot make Material throw. */
  protected readonly zeroBasedIndex = computed(() => Math.max(0, this.pagination().page - 1));

  protected onPage(event: PageEvent): void {
    this.pageChange.emit({ page: event.pageIndex + 1, pageSize: event.pageSize });
  }
}
