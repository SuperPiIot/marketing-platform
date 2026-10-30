import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './prisma';
import { sendVerificationEmail } from './email-templates/verification';
import { sendDeleteAccountVerificationEmail } from './email-templates/delete-account';

import { polar, checkout, portal, usage } from '@polar-sh/better-auth';
import { Polar } from '@polar-sh/sdk';

if (!process.env.POLAR_ACCESS_TOKEN) {
  throw new Error('POLAR_ACCESS_TOKEN environment variable is required');
}

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
});

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendVerificationEmail({
          email: user.email,
          url,
          name: user.name,
        });
      } catch (error) {
        throw new Error('Failed to send verification email. Please try again.');
      }
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirectURI: `${process.env.BETTER_AUTH_URL}/api/auth/callback/google`,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
  },
  basePath: '/api/auth',
  baseURL: process.env.BETTER_AUTH_URL as string,
  plugins: [
    polar({
      client: polarClient,
      use: [
        checkout({
          products: [
            ...(process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID_3K
              ? [{ productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID_3K, slug: 'Credits-3000' }]
              : []),
            ...(process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID_10K
              ? [{ productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID_10K, slug: 'Credits-10000' }]
              : []),
            ...(process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID_20K
              ? [{ productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_ID_20K, slug: 'Credits-20000' }]
              : []),
          ],
          successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
          authenticatedUsersOnly: true,
        }),
        portal(),
        usage(),
      ],
    }),
  ],
  user: {
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async ({ user, url }) => {
        try {
          await sendDeleteAccountVerificationEmail({
            email: user.email,
            url,
            name: user.name,
          });
        } catch {
          throw new Error(
            'Failed to send account deletion email. Please try again.'
          );
        }
      },
      beforeDelete: async (user) => {
        try {
          // Remove indirect subscriber events where foreign key is ON DELETE SET NULL
          await prisma.event.deleteMany({
            where: {
              subscriber: {
                list: {
                  userId: user.id,
                },
              },
            },
          });
        } catch (error) {
          console.error('Failed to cleanup subscriber events before user deletion', {
            userId: user.id,
            error,
          });
        }
      },
      afterDelete: async (user) => {
        try {
          // Wipe Polar customer profile and subscriptions (both cached polarCustomerId and external ID)
          const polarCustId = (user as any).polarCustomerId;
          let deleted = false;
          if (polarCustId) {
            try {
              await polarClient.customers.delete({ id: polarCustId });
              deleted = true;
            } catch (err: any) {
              const status = err?.statusCode ?? err?.status;
              if (status === 404) {
                deleted = true;
              }
            }
          }

          if (!deleted) {
            await polarClient.customers.deleteExternal({
              externalId: user.id,
            });
          }
        } catch (error) {
          console.error('Failed to delete Polar customer after account deletion', {
            userId: user.id,
            error,
          });
        }
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
