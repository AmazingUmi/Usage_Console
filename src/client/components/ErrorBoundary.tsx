import React from 'react';
import { getLang, translate } from '../i18n';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Usage Console render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const t = (key: string) => translate(getLang(), key);

    return (
      <main className="shell">
        <section className="panel" style={{ padding: '28px 32px', marginTop: '24px' }}>
          <h1 style={{ marginBottom: '8px' }}>{t('error.title')}</h1>
          <p className="hint">{t('error.body')}</p>
          <p className="notice" style={{ marginTop: '16px' }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="button-primary"
            style={{ marginTop: '18px' }}
            onClick={() => window.location.reload()}
          >
            {t('error.reload')}
          </button>
        </section>
      </main>
    );
  }
}
