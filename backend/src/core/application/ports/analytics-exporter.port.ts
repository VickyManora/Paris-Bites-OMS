import type { ReportFormat } from '../../domain/enums/report.enum.js';
import type { AnalyticsDto } from '../dtos/analytics.dto.js';
import type { ReportFile } from './report-exporter.port.js';

/**
 * Renders an analytics snapshot to a file.
 *
 * Deliberately **not** an `IReportExporter`. That port takes one column set and one row
 * set, which is the right shape for a report and the wrong one here: analytics is half a
 * dozen unrelated datasets plus a block of headline figures. Forcing it through would mean
 * either six separate exports or one sheet with six tables stacked in a column, and the
 * second is what people actually complain about in exported dashboards.
 *
 * The two implementations still share the report exporters' conventions — numbers stay
 * numbers in Excel, the filters and generator are printed on the file — because those
 * rules are about not misleading the reader, not about the shape of the data.
 */
export interface IAnalyticsExporter {
  readonly format: ReportFormat;
  export(snapshot: AnalyticsDto, generatedBy: string): Promise<ReportFile>;
}
