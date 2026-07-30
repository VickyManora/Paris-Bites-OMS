import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import type { Dashboard } from '../models/dashboard.model';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  /**
   * The whole dashboard in one request.
   *
   * `date` is the **browser's** calendar day. The server runs in UTC and the business does
   * not: at 02:00 in Mumbai it is still yesterday in UTC, so letting the server decide what
   * "today" means would show the wrong day's figures for five and a half hours every night.
   */
  load(windowDays = 14): Observable<Dashboard> {
    return this.api.get<Dashboard>('/dashboard', {
      params: { date: this.localToday(), windowDays },
    });
  }

  /** Local components, not `toISOString()`, which would convert to UTC and shift the day. */
  private localToday(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${String(now.getFullYear())}-${month}-${day}`;
  }
}
