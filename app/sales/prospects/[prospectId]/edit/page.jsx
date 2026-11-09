import CompanyContactEditor from "../../../../admin/sales/CompanyContactEditor";

export default async function SalesCompanyEditPage({ params, searchParams }) {
  const { prospectId } = await params;
  const query = await searchParams;
  const returnTo = ["contacts", "queue", "admin"].includes(query?.returnTo) ? query.returnTo : "queue";
  return <CompanyContactEditor prospectId={prospectId} returnTo={returnTo} />;
}
