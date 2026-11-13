import { Link, useParams } from 'react-router-dom';
import { Card, PageHeader } from '../../components/ui.tsx';

/** Placeholder for screens built in Milestone 3c. */
export default function ComingSoon({ title }: { title: string }) {
  const { teamId } = useParams();
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p>This screen is coming in the next milestone.</p>
        <Link to={`/teams/${teamId}`}>← Back to the overview</Link>
      </Card>
    </>
  );
}
