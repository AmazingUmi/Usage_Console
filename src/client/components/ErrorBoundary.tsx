import React from 'react';

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

    return (
      <main className="shell">
        <section className="panel" style={{ padding: '28px 32px', marginTop: '24px' }}>
          <h1 style={{ marginBottom: '8px' }}>页面渲染失败</h1>
          <p className="hint">控制台遇到未处理的界面错误，已拦截以避免整页空白。</p>
          <p className="notice" style={{ marginTop: '16px' }}>
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="button-primary"
            style={{ marginTop: '18px' }}
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
