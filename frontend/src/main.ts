import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // Bootstrap failure means the app never started; there is no UI to report it in.
  console.error('Failed to bootstrap the application', error);
});
