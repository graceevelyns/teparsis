export class Logger {
  private context: string;

  constructor(context: string = "Application") {
    this.context = context;
  }

  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${this.context}] ${message}`;
  }

  info(message: string): void {
    console.log(this.formatMessage("INFO", message));
  }

  warn(message: string): void {
    console.warn(this.formatMessage("WARN", message));
  }

  error(message: string, error?: Error): void {
    const errorMessage = error ? `${message}: ${error.message}` : message;
    console.error(this.formatMessage("ERROR", errorMessage));
    if (error?.stack) {
      console.error(error.stack);
    }
  }

  debug(message: string): void {
    if (process.env.NODE_ENV === "development") {
      console.debug(this.formatMessage("DEBUG", message));
    }
  }
}
