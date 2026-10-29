import { AuthProvider } from './app/AuthProvider';
import { Layout } from './app/Layout';
import { Router } from './app/router';
import { routeEntries } from './app/routes';

export function App() {
  return (
    <AuthProvider>
      <Layout>
        <Router entries={routeEntries} />
      </Layout>
    </AuthProvider>
  );
}
