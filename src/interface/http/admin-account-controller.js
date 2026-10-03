const text = (value) => (typeof value === 'string' ? value : undefined);

/** Controller akun admin: login/logout, profil, ubah password, kelola akun. */
export class AdminAccountController {
  constructor({ loginAdmin, changeOwnPassword, listAdminUsers, createAdminUser, deleteAdminUser, resetAdminPassword }) {
    Object.assign(this, { loginAdmin, changeOwnPassword, listAdminUsers, createAdminUser, deleteAdminUser, resetAdminPassword });
  }

  login = async ({ body, ip }) => {
    const { user, token } = await this.loginAdmin.execute({ username: text(body.username), password: text(body.password), ip });
    return { status: 200, body: { user }, session: { token } };
  };

  logout = async () => ({ status: 204, session: 'clear' });

  me = async ({ actor }) => ({ status: 200, body: { user: actor.user } });

  changePassword = async ({ body, actor }) => {
    const { user, token } = await this.changeOwnPassword.execute({
      userId: actor.user.id, currentPassword: text(body.currentPassword), newPassword: text(body.newPassword),
    });
    return { status: 200, body: { user }, session: { token } }; // token baru: sesi ini tetap berlaku, sesi lain dicabut
  };

  users = async () => ({ status: 200, body: { items: await this.listAdminUsers.execute() } });

  createUser = async ({ body }) => ({
    status: 201,
    body: await this.createAdminUser.execute({ username: text(body.username), displayName: text(body.displayName), password: text(body.password) }),
  });

  removeUser = async ({ params, actor }) => {
    await this.deleteAdminUser.execute({ id: params.id, actingUserId: actor.user.id });
    return { status: 204 };
  };

  resetPassword = async ({ params, body, actor }) => {
    await this.resetAdminPassword.execute({ id: params.id, newPassword: text(body.newPassword), actingUserId: actor.user.id });
    return { status: 204 };
  };
}
