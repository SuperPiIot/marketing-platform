import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deletePolarCustomer } from '@/lib/polar/polar-customer.service';
import { sendDeleteAccountEmail } from '@/lib/email-templates/delete-account';

export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        suspended: true,
        suspendedAt: true,
        suspendedReason: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      suspended: user.suspended,
      suspendedAt: user.suspendedAt,
      suspendedReason: user.suspendedReason,
    });
  } catch (error) {
    console.error('Error fetching user status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session || !session.user || !session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        polarCustomerId: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 1. Delete indirect events linked to user subscribers before cascading
    await prisma.event.deleteMany({
      where: {
        subscriber: {
          list: {
            userId: user.id,
          },
        },
      },
    });

    // 2. Wipe Polar customer by cached ID and external ID fallback
    await deletePolarCustomer(user.id, user.polarCustomerId);

    // 3. Delete user locally
    await prisma.user.delete({
      where: { id: user.id },
    });

    // 4. Send account deletion confirmation email
    await sendDeleteAccountEmail(user.email);

    // 5. Status 204 must return an empty body without JSON
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
