import CallRecord from "./CallRecord";

export default async function SalesCallRecordPage({ params }) {
  const { salesCallId } = await params;
  return <CallRecord salesCallId={salesCallId} />;
}
