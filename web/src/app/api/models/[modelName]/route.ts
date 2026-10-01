export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ modelName: string }> }
) {
  return Response.json(
    {
      status: "error",
      message: `Model '${(await params).modelName}' is managed by the daily worker and is not deleted through public API routes.`,
    },
    { status: 404 }
  );
}
